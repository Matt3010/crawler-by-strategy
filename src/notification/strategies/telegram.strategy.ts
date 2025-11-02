import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INotificationStrategy } from './notification.strategy.interface';
import { NotificationPayload } from '../notification.types';

@Injectable()
export class TelegramNotificationStrategy implements INotificationStrategy {
  private readonly logger = new Logger(TelegramNotificationStrategy.name);
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly apiBaseUrl: string;
  private readonly MAX_CAPTION_LENGTH = 1024; // Limite di Telegram
  private readonly MAX_MESSAGE_LENGTH = 4096; // Limite di Telegram

  constructor(private readonly configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    this.chatId = this.configService.get<string>('TELEGRAM_CHAT_ID');

    if (!this.botToken || !this.chatId) {
      this.logger.warn('Token o ChatID Telegram non configurati. Strategia disabilitata.');
    } else {
      this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`;
    }
  }

  getStrategyId(): string {
    return 'telegram';
  }

  /**
   * Decide se inviare una foto con didascalia o un messaggio di testo.
   * Gestisce didascalie > 1024 caratteri inviando messaggi separati.
   */
  async sendNotification(payload: NotificationPayload): Promise<void> {
    if (!this.apiBaseUrl) {
      this.logger.debug(`Strategia Telegram saltata (non configurata): ${payload.message.substring(0, 50)}...`);
      return;
    }

    if (payload.imageUrl) {
      try {
        await this.sendPhotoWithCaption(payload.message, payload.imageUrl);
      } catch (error) {
        this.logger.error(`Fallimento sendPhotoWithCaption: ${error.message}. Fallback a sendMessage.`);
        await this.sendMessage(payload.message); // Fallback
      }
    } else {
      await this.sendMessage(payload.message); // No image
    }
  }

  /**
   * Logica di invio foto + didascalia.
   * Se la didascalia è > 1024, invia la foto da sola e il testo in un secondo messaggio.
   */
  private async sendPhotoWithCaption(caption: string, photoUrl: string): Promise<void> {
    const sanitizedCaption = this.sanitize(caption);

    if (sanitizedCaption.length > this.MAX_CAPTION_LENGTH) {
      this.logger.warn(`Didascalia > 1024. Invio foto e testo separati.`);
      // 1. Invia foto senza didascalia
      await this.sendPhotoApi(photoUrl);
      // 2. Invia testo
      await this.sendMessage(caption); // Usa la didascalia originale (non sanificata per sendMessage)
    } else {
      // La didascalia rientra nei limiti, invia insieme
      await this.sendPhotoApi(photoUrl, sanitizedCaption);
    }
  }

  /**
   * Formatta e sanifica un messaggio per Telegram MarkdownV2.
   */
  private sanitize(message: string): string {
    return message.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }

  /**
   * Invia un messaggio di solo testo (gestisce > 4096).
   */
  private async sendMessage(message: string): Promise<void> {
    const sanitizedMessage = this.sanitize(message);

    if (sanitizedMessage.length <= this.MAX_MESSAGE_LENGTH) {
      await this.sendMessageApi(sanitizedMessage);
    } else {
      // Messaggio troppo lungo, invia in chunk
      this.logger.warn(`Messaggio > 4096, invio in più parti.`);
      const chunks = this.splitMessage(sanitizedMessage, this.MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        await this.sendMessageApi(chunk);
      }
    }
  }

  /**
   * Chiamata API effettiva per sendMessage
   */
  private async sendMessageApi(sanitizedMessage: string): Promise<void> {
    const body = JSON.stringify({
      chat_id: this.chatId,
      text: sanitizedMessage,
      parse_mode: 'MarkdownV2',
    });

    try {
      const response = await fetch(`${this.apiBaseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      });

      if (!response.ok) {
        const errorData = await response.json();
        this.logger.error(`Errore sendMessageApi: ${response.status} - ${errorData.description}`);
        if (errorData.description.includes('parse')) {
           this.logger.warn('Invio Markdown fallito. Riprovo con testo semplice.');
           await this.sendSimpleTextFallback(sanitizedMessage); // Usa il messaggio già sanificato ma senza parse_mode
        }
      }
    } catch (error) {
      this.logger.error(`Errore fetch (sendMessageApi): ${error.message}`, error.stack);
    }
  }

  /**
   * Chiamata API effettiva per sendPhoto
   */
  private async sendPhotoApi(photoUrl: string, caption?: string): Promise<void> {
    const body = JSON.stringify({
      chat_id: this.chatId,
      photo: photoUrl,
      caption: caption,
      parse_mode: caption ? 'MarkdownV2' : undefined,
    });

    const response = await fetch(`${this.apiBaseUrl}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });

    if (!response.ok) {
      const errorData = await response.json();
      // Se fallisce per il parse, lancia errore per far riprovare il parent
      if (caption && errorData.description.includes('parse')) {
        this.logger.warn('Parse didascalia fallito, gestito dal chiamante.');
      }
      this.logger.error(`Errore sendPhotoApi: ${errorData.description}`);
      throw new Error(errorData.description); // Causa il fallback in sendNotification
    }
  }

  /**
   * Fallback estremo per inviare testo semplice senza formattazione.
   */
  private async sendSimpleTextFallback(message: string): Promise<void> {
     // Rimuove solo i caratteri di escape Markdown
     const simpleText = message.replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, '$1');
     const body = JSON.stringify({
      chat_id: this.chatId,
      text: simpleText,
    });
     try {
        await fetch(`${this.apiBaseUrl}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
        });
     } catch (e) {
        this.logger.error(`Errore fetch API Telegram (Fallback): ${e.message}`);
     }
  }

  /**
   * Divide un messaggio lungo in chunk.
   */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks = [];
    let currentChunk = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      currentChunk += line + '\n';
    }
    chunks.push(currentChunk); // Aggiunge l'ultimo chunk
    return chunks;
  }
}
