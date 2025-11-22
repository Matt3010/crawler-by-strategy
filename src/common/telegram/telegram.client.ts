import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TelegramClient {
    private readonly logger = new Logger(TelegramClient.name);

    private readonly BASE_API_URL: string = 'https://api.telegram.org/bot';
    private readonly MAX_MESSAGE_LENGTH: number = 4096;
    private readonly MAX_CAPTION_LENGTH: number = 1024;
    private readonly PARSE_MODE: string = 'MarkdownV2';

    public async sendMessage(token: string, chatId: string, text: string, threadId?: string, disableNotification = false): Promise<void> {
        if (!this.isValidRequest(token, chatId, text)) return;

        const safeText: string = this.sanitizeText(text);

        if (this.isTextTooLong(safeText, this.MAX_MESSAGE_LENGTH)) {
            await this.sendChunkedText(token, chatId, safeText, threadId, disableNotification);
        } else {
            await this.sendSingleText(token, chatId, safeText, threadId, disableNotification);
        }
    }

    public async sendPhoto(token: string, chatId: string, photoUrl: string, caption?: string, threadId?: string, disableNotification = false): Promise<void> {
        if (!this.isValidRequest(token, chatId, photoUrl)) return;

        const safeCaption: string = caption ? this.sanitizeText(caption) : undefined;

        if (this.isCaptionTooLong(safeCaption)) {
            await this.sendPhotoWithSeparateText(token, chatId, photoUrl, caption, threadId, disableNotification);
        } else {
            await this.sendPhotoWithCaption(token, chatId, photoUrl, safeCaption, threadId, disableNotification);
        }
    }

    private async sendSingleText(token: string, chatId: string, text: string, threadId: string | undefined, disableNotification: boolean): Promise<void> {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: this.PARSE_MODE,
            message_thread_id: threadId,
            disable_notification: disableNotification
        };
        await this.performApiCall(token, 'sendMessage', payload);
    }

    private async sendChunkedText(token: string, chatId: string, text: string, threadId: string | undefined, disableNotification: boolean): Promise<void> {
        this.logger.debug(`Messaggio lungo (${text.length} chars). Attivazione strategia chunking.`);

        const chunks: string[] = this.splitTextIntoChunks(text, this.MAX_MESSAGE_LENGTH);

        for (const chunk of chunks) {
            await this.sendSingleText(token, chatId, chunk, threadId, disableNotification);
        }
    }

    private async sendPhotoWithCaption(token: string, chatId: string, photoUrl: string, safeCaption: string | undefined, threadId: string | undefined, disableNotification: boolean): Promise<void> {
        const payload = {
            chat_id: chatId,
            photo: photoUrl,
            caption: safeCaption,
            parse_mode: safeCaption ? this.PARSE_MODE : undefined,
            message_thread_id: threadId,
            disable_notification: disableNotification
        };
        await this.performApiCall(token, 'sendPhoto', payload);
    }

    private async sendPhotoWithSeparateText(token: string, chatId: string, photoUrl: string, fullRawCaption: string, threadId: string | undefined, disableNotification: boolean): Promise<void> {
        await this.performApiCall(token, 'sendPhoto', {
            chat_id: chatId,
            photo: photoUrl,
            message_thread_id: threadId,
            disable_notification: disableNotification
        });
        await this.sendMessage(token, chatId, fullRawCaption, threadId, disableNotification);
    }

    private async performApiCall(token: string, method: string, payload: any, isRetry = false): Promise<void> {
        const url: string = this.buildApiUrl(token, method);
        this.cleanPayload(payload);

        try {
            const response: Response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                await this.handleApiError(response, token, method, payload, isRetry);
            }
        } catch (error) {
            this.logNetworkError(method, error);
        }
    }

    private async handleApiError(response: Response, token: string, method: string, payload: any, isRetry: boolean): Promise<void> {
        const errorData = await response.json();

        if (this.shouldRetryWithoutMarkdown(errorData, payload, isRetry)) {
            await this.retryWithPlainText(token, method, payload);
            return;
        }

        this.logger.error(`Telegram API Error [${method}]: ${errorData.description}`);
    }

    private shouldRetryWithoutMarkdown(errorData: any, payload: any, isRetry: boolean): boolean {
        const isParseError = errorData?.description?.includes('parse');
        const hasParseMode: boolean = !!payload.parse_mode;
        return isParseError && hasParseMode && !isRetry;
    }

    private async retryWithPlainText(token: string, method: string, payload: any): Promise<void> {
        this.logger.warn(`Errore Markdown rilevato in [${method}]. Downgrade a testo semplice.`);

        delete payload.parse_mode;
        this.unescapePayloadContent(payload);

        await this.performApiCall(token, method, payload, true);
    }

    private buildApiUrl(token: string, method: string): string {
        return `${this.BASE_API_URL}${token}/${method}`;
    }

    private isValidRequest(token: string, chatId: string, content: string): boolean {
        return !!(token && chatId && content);
    }

    private isTextTooLong(text: string, limit: number): boolean {
        return text.length > limit;
    }

    private isCaptionTooLong(caption: string | undefined): boolean {
        return !!caption && caption.length > this.MAX_CAPTION_LENGTH;
    }

    private cleanPayload(payload: any): void {
        Object.keys(payload).forEach((key: string) => payload[key] === undefined && delete payload[key]);
    }

    private sanitizeText(text: string): string {
        return text.replaceAll(/([_*[\]()~`>#+\-=|{}.!])/g, String.raw`\$1`);
    }

    private unescapePayloadContent(payload: any): void {
        const unescapeRegex = /\\([_*[\]()~`>#+\-=|{}.!])/g;
        if (payload.text) payload.text = payload.text.replaceAll(unescapeRegex, '$1');
        if (payload.caption) payload.caption = payload.caption.replaceAll(unescapeRegex, '$1');
    }

    private logNetworkError(method: string, error: unknown): void {
        const message: string = error instanceof Error ? error.message : 'network error';
        this.logger.error(`Network Error [${method}]: ${message}`);
    }

    private splitTextIntoChunks(text: string, maxLength: number): string[] {
        const chunks: string[] = [];
        if (!text) return chunks;

        let currentChunk: string = '';
        const lines: string[] = text.split('\n');

        for (const line of lines) {
            if (line.length > maxLength) {
                this.handleHugeLine(line, maxLength, currentChunk, chunks);
                currentChunk = '';
                continue;
            }

            if (this.willOverflow(currentChunk, line, maxLength)) {
                chunks.push(currentChunk);
                currentChunk = '';
            }

            currentChunk = this.appendLineToChunk(currentChunk, line);
        }

        if (currentChunk) chunks.push(currentChunk);
        return chunks;
    }

    private handleHugeLine(line: string, maxLength: number, currentChunk: string, chunks: string[]): void {
        if (currentChunk) chunks.push(currentChunk);

        let remaining: string = line;
        while (remaining.length > 0) {
            chunks.push(remaining.slice(0, maxLength));
            remaining = remaining.slice(maxLength);
        }
    }

    private willOverflow(currentChunk: string, line: string, maxLength: number): boolean {
        return currentChunk.length + line.length + 1 > maxLength;
    }

    private appendLineToChunk(chunk: string, line: string): string {
        return chunk.length > 0 ? `${chunk}\n${line}` : line;
    }
}