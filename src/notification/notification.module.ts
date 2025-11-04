import { Module, Global } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { TelegramNotificationStrategy } from './strategies/telegram.strategy';

const strategies  = [
  TelegramNotificationStrategy,
];

@Global()
@Module({
  imports: [],
  providers: [
    NotificationService,
    ...strategies
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
