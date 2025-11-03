export interface NotificationPayload {
    message: string;
    imageUrl?: string;
}

export interface TargetedNotification {
    payload: NotificationPayload;
    channels: string[] | null;
}