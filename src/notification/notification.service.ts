import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INotificationStrategy } from './strategies/notification.strategy.interface';
import { TelegramNotificationStrategy } from './strategies/telegram.strategy';
import { NotificationPayload, TargetedNotification } from './notification.types';

@Injectable()
export class NotificationService {
    private readonly logger: Logger = new Logger(NotificationService.name);
    private readonly activeStrategies: INotificationStrategy[] = [];
    private readonly activeStrategiesMap: Map<string, INotificationStrategy> = new Map();

    constructor(
        private readonly configService: ConfigService,
    ) {
        this.buildStrategyList();
    }

    private buildStrategyList(): void {
        const strategyIds: string[] = (this.configService.get<string>('NOTIFICATION_STRATEGIES') || '')
            .split(',')
            .map((s: string): string => s.trim().toLowerCase())
            .filter(Boolean);

        if (strategyIds.length === 0) {
            this.logger.warn('Nessuna strategia definita in NOTIFICATION_STRATEGIES. Notifiche disabilitate.');
            return;
        }

        this.logger.log(`Inizializzazione strategie di notifica: ${strategyIds.join(', ')}`);

        for (const id of strategyIds) {
            const type: string = this.configService.get<string>(`${id.toUpperCase()}_TYPE`)?.toLowerCase();

            if (!type) {
                this.logger.warn(`Tipo non definito per la strategia "${id}" (manca ${id.toUpperCase()}_TYPE). Salto.`);
                continue;
            }

            let strategy: INotificationStrategy = null;

            try {
                if (type === 'telegram') {
                    strategy = this.buildTelegramStrategy(id);
                } else {
                    this.logger.warn(`Tipo di strategia "${type}" per ID "${id}" non riconosciuto.`);
                }

                if (strategy) {
                    this.activeStrategies.push(strategy);
                    this.activeStrategiesMap.set(id, strategy);
                    this.logger.log(`Strategia [${id}] (tipo: ${type}) attivata.`);
                } else {
                    this.logger.warn(`Strategia [${id}] (tipo: ${type}) non attivata (configurazione mancante?).`);
                }
            } catch (error) {
                this.logger.error(`Errore durante la creazione della strategia [${id}]: ${error.message}`, error.stack);
            }
        }

        if (this.activeStrategies.length === 0) {
            this.logger.warn('Nessuna strategia di notifica è stata attivata con successo.');
        } else {
            this.logger.log(`Strategie attive totali: ${this.activeStrategies.length}`);
        }
    }

    private buildTelegramStrategy(id: string): INotificationStrategy | null {
        const token: string = this.configService.get<string>(`${id.toUpperCase()}_TOKEN`);
        const chatId: string = this.configService.get<string>(`${id.toUpperCase()}_CHAT_ID`);

        if (!token || !chatId) {
            this.logger.warn(`Configurazione (TOKEN o CHAT_ID) mancante per la strategia Telegram [${id}].`);
            return null;
        }

        const strategyLogger = new Logger(`${TelegramNotificationStrategy.name} [${id}]`);

        return new TelegramNotificationStrategy(id, token, chatId, strategyLogger);
    }


    async sendNotification(message: string, imageUrl?: string): Promise<void> {
        const payload: NotificationPayload = { message, imageUrl };
        await this.sendToChannels(payload, null);
    }

    async sendTargetedNotification(notification: TargetedNotification): Promise<void> {
        await this.sendToChannels(notification.payload, notification.channels);
    }

    private async sendToChannels(payload: NotificationPayload, channels: string[] | null): Promise<void> {
        if (this.activeStrategies.length === 0) {
            this.logger.debug(`Nessuna notifica inviata (strategie non attive): ${payload.message.substring(0, 50)}...`);
            return;
        }

        let targetStrategies: INotificationStrategy[] = [];

        if (!channels || channels.length === 0) {
            targetStrategies = this.activeStrategies;
            this.logger.log(`Invio notifica a tutti i ${targetStrategies.length} canali attivi.`);
        } else {
            this.logger.log(`Invio notifica ai canali target: ${channels.join(', ')}`);
            for (const channelId of channels) {
                const strategy: INotificationStrategy = this.activeStrategiesMap.get(channelId); // Qui avviene la magia
                if (strategy) {
                    targetStrategies.push(strategy);
                } else {
                    this.logger.warn(`Canale di notifica "${channelId}" richiesto ma non trovato o non attivo.`);
                }
            }
        }

        if (targetStrategies.length === 0) {
            this.logger.warn(`Nessuna strategia di notifica valida trovata per l'invio.`);
            return;
        }

        const promises: Promise<void>[] = targetStrategies.map((strategy: INotificationStrategy): Promise<void> =>
            strategy.sendNotification(payload).catch((err: any): void => {
                this.logger.error(`Fallimento strategia [${strategy.getStrategyId()}]: ${err.message}`, err.stack);
            })
        );

        await Promise.allSettled(promises);
    }
}