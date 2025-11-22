import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INotificationStrategy } from './strategies/notification.strategy.interface';
import { TelegramNotificationStrategy } from './strategies/telegram.strategy';
import { NotificationPayload, TargetedNotification } from './notification.types';
import { TelegramClient } from 'src/common/telegram/telegram.client';

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);
    private readonly activeStrategies: Map<string, INotificationStrategy> = new Map();

    constructor(
        private readonly configService: ConfigService,
        private readonly telegramClient: TelegramClient
    ) {
        this.buildStrategyList();
    }

    private buildStrategyList(): void {
        const strategyIds: string[] = (this.configService.get<string>('NOTIFICATION_STRATEGIES') || '')
            .split(',').map((s: string): string => s.trim().toLowerCase()).filter(Boolean);

        for (const id of strategyIds) {
            const type: string = this.configService.get<string>(`${id.toUpperCase()}_TYPE`)?.toLowerCase();
            if (type === 'telegram') {
                const token: string = this.configService.get<string>(`${id.toUpperCase()}_TOKEN`);
                const chatId: string = this.configService.get<string>(`${id.toUpperCase()}_CHAT_ID`);

                if (token && chatId) {
                    const strategy = new TelegramNotificationStrategy(id, token, chatId, this.telegramClient);
                    this.activeStrategies.set(id, strategy);
                    this.logger.log(`Strategy [${id}] (Telegram) activated.`);
                }
            }
        }
    }

    async sendNotification(message: string, imageUrl?: string): Promise<void> {
        const payload: NotificationPayload = { message, imageUrl };
        await this.sendToChannels(payload, Array.from(this.activeStrategies.values()));
    }

    async sendTargetedNotification(notification: TargetedNotification): Promise<void> {
        const strategies: INotificationStrategy[] = [];
        if (notification.channels) {
            for (const ch of notification.channels) {
                const s: INotificationStrategy = this.activeStrategies.get(ch);
                if (s) strategies.push(s);
            }
        } else {
            strategies.push(...this.activeStrategies.values());
        }
        await this.sendToChannels(notification.payload, strategies);
    }

    private async sendToChannels(payload: NotificationPayload, strategies: INotificationStrategy[]): Promise<void> {
        const promises: Promise<void>[] = strategies.map((s: INotificationStrategy): Promise<void> => s.sendNotification(payload));
        await Promise.allSettled(promises);
    }
}