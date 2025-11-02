import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { INotificationStrategy } from './strategies/notification.strategy.interface';
import { TelegramNotificationStrategy } from './strategies/telegram.strategy';
import { NotificationPayload } from './notification.types';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private activeStrategies: INotificationStrategy[] = [];

  constructor(
    private readonly configService: ConfigService,

    // --- Inietta qui TUTTE le strategie definite nel module ---
    private readonly telegramStrategy: TelegramNotificationStrategy,
    // private readonly slackStrategy: SlackNotificationStrategy, // Esempio futuro
  ) {
    this.buildStrategyList();
  }

  private buildStrategyList() {
    const allStrategies: Record<string, INotificationStrategy> = {
      'telegram': this.telegramStrategy,
      // 'slack': this.slackStrategy,
    };

    const activeStrategyIds = (this.configService.get<string>('NOTIFICATION_STRATEGIES') || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    for (const id of activeStrategyIds) {
      const strategy = allStrategies[id];
      if (strategy) {
        this.activeStrategies.push(strategy);
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

  /**
   * Invia una notifica (testo + immagine opzionale) a tutte le strategie attive.
   * @param message Il testo del messaggio.
   * @param imageUrl L'URL opzionale di un'immagine da allegare.
   */
  async sendNotification(message: string, imageUrl?: string): Promise<void> {
    if (this.activeStrategies.length === 0) {
      this.logger.debug(`Nessuna notifica inviata (strategie non attive): ${message.substring(0, 50)}...`);
      return;
    }

    const payload: NotificationPayload = { message, imageUrl };

    // Invia a tutte le strategie attive in parallelo
    const promises = this.activeStrategies.map(strategy =>
      strategy.sendNotification(payload).catch(err => {
        this.logger.error(`Fallimento strategia [${strategy.getStrategyId()}]: ${err.message}`, err.stack);
      })
    );

    await Promise.allSettled(promises);
  }
}
