import { Logger } from '@nestjs/common';
import { INotificationStrategy } from './notification.strategy.interface';
import { NotificationPayload } from '../notification.types';

export class TelegramNotificationStrategy implements INotificationStrategy {
    private readonly logger: Logger;
    private readonly apiBaseUrl: string;
    private readonly MAX_CAPTION_LENGTH: number = 1024;
    private readonly MAX_MESSAGE_LENGTH: number = 4096;

    private readonly chatGroupId: string;
    private readonly messageThreadId: string | undefined;

    constructor(
        private readonly id: string,
        private readonly botToken: string,
        chatId: string,
        logger?: Logger,
    ) {
        this.logger = logger || new Logger(`${TelegramNotificationStrategy.name} [${id}]`);

        if (!this.botToken || !chatId) {
            this.logger.warn(`Token or ChatID not configured. Strategy [${this.id}] disabled.`);
        } else {
            this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`;

            if (chatId.includes('_')) {
                const parts = chatId.split('_');
                this.chatGroupId = parts[0];
                this.messageThreadId = parts[1];
                this.logger.log(`Telegram strategy [${this.id}] configured for Chat: ${this.chatGroupId}, Topic: ${this.messageThreadId}`);
            } else {
                this.chatGroupId = chatId;
                this.messageThreadId = undefined;
                this.logger.log(`Telegram strategy [${this.id}] configured for Chat: ${this.chatGroupId.substring(0, 4)}... (no topic)`);
            }
        }
    }

    getStrategyId(): string {
        return this.id;
    }

    async sendNotification(payload: NotificationPayload): Promise<void> {
        if (!this.apiBaseUrl) {
            this.logger.debug(`Telegram strategy [${this.id}] skipped (not configured): ${payload.message.substring(0, 50)}...`);
            return;
        }

        if (payload.imageUrl) {
            try {
                await this.sendPhotoWithCaption(payload.message, payload.imageUrl);
            } catch (error) {
                this.logger.error(`sendPhotoWithCaption failed [${this.id}]: ${error.message}. Falling back to sendMessage.`);
                await this.sendMessage(payload.message);
            }
        } else {
            await this.sendMessage(payload.message);
        }
    }

    private async sendPhotoWithCaption(caption: string, photoUrl: string): Promise<void> {
        const sanitizedCaption: string = this.sanitize(caption);

        if (sanitizedCaption.length > this.MAX_CAPTION_LENGTH) {
            this.logger.warn(`Caption > 1024 [${this.id}]. Sending photo and text separately.`);
            await this.sendPhotoApi(photoUrl);
            await this.sendMessage(caption);
        } else {
            await this.sendPhotoApi(photoUrl, sanitizedCaption);
        }
    }

    private sanitize(message: string): string {
        return message.replaceAll(/([_*[\]()~`>#+\-=|{}.!])/g, String.raw`\$1`);
    }

    private async sendMessage(message: string): Promise<void> {
        const sanitizedMessage: string = this.sanitize(message);

        if (sanitizedMessage.length <= this.MAX_MESSAGE_LENGTH) {
            await this.sendMessageApi(sanitizedMessage);
        } else {
            this.logger.warn(`Message > 4096 [${this.id}], sending in multiple parts.`);
            const chunks: string[] = this.splitMessage(sanitizedMessage, this.MAX_MESSAGE_LENGTH);
            for (const chunk of chunks) {
                await this.sendMessageApi(chunk);
            }
        }
    }

    private async sendMessageApi(sanitizedMessage: string): Promise<void> {
        const payload: any = {
            chat_id: this.chatGroupId,
            text: sanitizedMessage,
            parse_mode: 'MarkdownV2',
        };

        if (this.messageThreadId) {
            payload.message_thread_id = this.messageThreadId;
        }

        const body: string = JSON.stringify(payload);

        try {
            const response: Response = await fetch(`${this.apiBaseUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
            });

            if (!response.ok) {
                const errorData: any = await response.json();
                this.logger.error(`sendMessageApi error [${this.id}]: ${response.status} - ${errorData.description}`);
                if (errorData.description.includes('parse')) {
                    this.logger.warn(`Markdown sending failed [${this.id}]. Retrying with plain text.`);
                    await this.sendSimpleTextFallback(sanitizedMessage);
                }
            }
        } catch (error) {
            this.logger.error(`Fetch error (sendMessageApi) [${this.id}]: ${error.message}`, error.stack);
        }
    }

    private async sendPhotoApi(photoUrl: string, caption?: string): Promise<void> {
        const payload: any = {
            chat_id: this.chatGroupId,
            photo: photoUrl,
            caption: caption,
            parse_mode: caption ? 'MarkdownV2' : undefined,
        };

        if (this.messageThreadId) {
            payload.message_thread_id = this.messageThreadId;
        }

        const body: string = JSON.stringify(payload);

        const response: Response = await fetch(`${this.apiBaseUrl}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body,
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (caption && errorData.description.includes('parse')) {
                this.logger.warn(`Caption parse failed [${this.id}], handled by caller.`);
            }
            this.logger.error(`sendPhotoApi error [${this.id}]: ${errorData.description}`);
            throw new Error(errorData.description);
        }
    }

    private async sendSimpleTextFallback(message: string): Promise<void> {
        const simpleText: string = message.replaceAll(/\\([_*[\]()~`>#+\-=|{}.!])/g, '$1');

        const payload: any = {
            chat_id: this.chatGroupId,
            text: simpleText,
        };

        if (this.messageThreadId) {
            payload.message_thread_id = this.messageThreadId;
        }

        const body: string = JSON.stringify(payload);
        try {
            await fetch(`${this.apiBaseUrl}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body,
            });
        } catch (e) {
            this.logger.error(`Telegram API fetch error (Fallback) [${this.id}]: ${e.message}`);
        }
    }

    private splitMessage(text: string, maxLength: number): string[] {
        const chunks: string[] = [];
        let currentChunk: string = '';
        const lines: string[] = text.split('\n');

        for (const line of lines) {
            if (currentChunk.length + line.length + 1 > maxLength) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            currentChunk += line + '\n';
        }
        chunks.push(currentChunk);
        return chunks;
    }
}