import { NotificationPayload } from '../notification.types';

export interface INotificationStrategy {
  /**
   * Ritorna l'ID univoco per questa strategia (es. "telegram", "slack")
   */
  getStrategyId(): string;

  /**
   * Invia la notifica.
   * @param payload Il payload contenente il messaggio e l'eventuale immagine.
   */
  sendNotification(payload: NotificationPayload): Promise<void>;
}
