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
            this.logger.warn('No strategy defined in NOTIFICATION_STRATEGIES. Notifications are disabled.');
            return;
        }

        this.logger.log(`Initializing notification strategies: ${strategyIds.join(', ')}`);

        for (const id of strategyIds) {
            const type: string = this.configService.get<string>(`${id.toUpperCase()}_TYPE`)?.toLowerCase();

            if (!type) {
                this.logger.warn(`Type not defined for strategy "${id}" (missing ${id.toUpperCase()}_TYPE). Skipping.`);
                continue;
            }

            let strategy: INotificationStrategy = null;

            try {
                if (type === 'telegram') {
                    strategy = this.buildTelegramStrategy(id);
                } else {
                    this.logger.warn(`Strategy type "${type}" for ID "${id}" not recognized.`);
                }

                if (strategy) {
                    this.activeStrategies.push(strategy);
                    this.activeStrategiesMap.set(id, strategy);
                    this.logger.log(`Strategy [${id}] (type: ${type}) activated.`);
                } else {
                    this.logger.warn(`Strategy [${id}] (type: ${type}) not activated (missing configuration?).`);
                }
            } catch (error) {
                this.logger.error(`Error creating strategy [${id}]: ${error.message}`, error.stack);
            }
        }

        if (this.activeStrategies.length === 0) {
            this.logger.warn('No notification strategy was successfully activated.');
        } else {
            this.logger.log(`Total active strategies: ${this.activeStrategies.length}`);
        }
    }

    private buildTelegramStrategy(id: string): INotificationStrategy | null {
        const token: string = this.configService.get<string>(`${id.toUpperCase()}_TOKEN`);
        const chatId: string = this.configService.get<string>(`${id.toUpperCase()}_CHAT_ID`);

        if (!token || !chatId) {
            this.logger.warn(`Configuration (TOKEN or CHAT_ID) missing for Telegram strategy [${id}].`);
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
            this.logger.debug(`No notification sent (no active strategies): ${payload.message.substring(0, 50)}...`);
            return;
        }

        let targetStrategies: INotificationStrategy[] = [];

        if (!channels || channels.length === 0) {
            targetStrategies = this.activeStrategies;
            this.logger.log(`Sending notification to all ${targetStrategies.length} active channels.`);
        } else {
            this.logger.log(`Sending notification to targeted channels: ${channels.join(', ')}`);
            for (const channelId of channels) {
                const strategy: INotificationStrategy = this.activeStrategiesMap.get(channelId);
                if (strategy) {
                    targetStrategies.push(strategy);
                } else {
                    this.logger.warn(`Notification channel "${channelId}" requested but not found or inactive.`);
                }
            }
        }

        if (targetStrategies.length === 0) {
            this.logger.warn('No valid notification strategy found for sending.');
            return;
        }

        const promises: Promise<void>[] = targetStrategies.map((strategy: INotificationStrategy): Promise<void> =>
            strategy.sendNotification(payload).catch((err: any): void => {
                this.logger.error(`Strategy failure [${strategy.getStrategyId()}]: ${err.message}`, err.stack);
            })
        );

        await Promise.allSettled(promises);
    }
}
