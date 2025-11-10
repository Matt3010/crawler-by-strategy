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
        private readonly telegramStrategy: TelegramNotificationStrategy,
    ) {
        this.buildStrategyList();
    }

    private buildStrategyList(): void {
        const allStrategies: Record<string, INotificationStrategy> = {
            'telegram': this.telegramStrategy,
        };

        const activeStrategyIds: string[] = (this.configService.get<string>('NOTIFICATION_STRATEGIES') || '')
            .split(',')
            .map((s: string): string => s.trim().toLowerCase())
            .filter(Boolean);

        for (const id of activeStrategyIds) {
            const strategy: INotificationStrategy = allStrategies[id];
            if (strategy) {
                this.activeStrategies.push(strategy);
                this.activeStrategiesMap.set(id, strategy);
            } else {
                this.logger.warn(`Strategia di notifica "${id}" non riconosciuta.`);
            }
        }

        if (this.activeStrategies.length === 0) {
            this.logger.warn('Nessuna strategia di notifica attiva. Le notifiche sono disabilitate.');
        } else {
            this.logger.log(`Strategie di notifica attive: ${activeStrategyIds.join(', ')}`);
        }
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
                const strategy: INotificationStrategy = this.activeStrategiesMap.get(channelId);
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