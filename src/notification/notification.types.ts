export interface NotificationPayload {
    message: string;
    imageUrl?: string;
    disableNotification?: boolean;
}

export interface TargetedNotification {
    payload: NotificationPayload;
    channels: string[] | null;
}