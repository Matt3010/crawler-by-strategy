import { Logger } from '@nestjs/common';
import { INotificationStrategy } from './notification.strategy.interface';
import { NotificationPayload } from '../notification.types';
import { TelegramClient } from 'src/common/telegram/telegram.client';

export class TelegramNotificationStrategy implements INotificationStrategy {
    private readonly logger: Logger;
    private readonly chatGroupId: string;
    private readonly messageThreadId: string | undefined;

    constructor(
        private readonly id: string,
        private readonly botToken: string,
        chatId: string,
        private readonly telegramClient: TelegramClient,
    ) {
        this.logger = new Logger(`${TelegramNotificationStrategy.name} [${id}]`);

        if (chatId.includes('_')) {
            const parts: string[] = chatId.split('_');
            this.chatGroupId = parts[0];
            this.messageThreadId = parts[1];
            this.logger.log(`Strategy [${id}] Topic: ${this.messageThreadId}`);
        } else {
            this.chatGroupId = chatId;
            this.messageThreadId = undefined;
        }
    }

    getStrategyId(): string {
        return this.id;
    }

    async sendNotification(payload: NotificationPayload): Promise<void> {
        const disableNotification: boolean = payload.disableNotification === true;

        try {
            if (payload.imageUrl) {
                await this.telegramClient.sendPhoto(
                    this.botToken,
                    this.chatGroupId,
                    payload.imageUrl,
                    payload.message,
                    this.messageThreadId,
                    disableNotification
                );
            } else {
                await this.telegramClient.sendMessage(
                    this.botToken,
                    this.chatGroupId,
                    payload.message,
                    this.messageThreadId,
                    disableNotification
                );
            }
        } catch (error) {
            this.logger.error(`Errore strategia [${this.id}]: ${error.message}`);
        }
    }
}