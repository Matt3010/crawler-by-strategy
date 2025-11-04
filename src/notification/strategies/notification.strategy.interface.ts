import { NotificationPayload } from '../notification.types';

export interface INotificationStrategy {
  getStrategyId(): string;
  sendNotification(payload: NotificationPayload): Promise<void>;
}
