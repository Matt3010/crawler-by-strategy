import { Module, Global } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { TelegramNotificationStrategy } from './strategies/telegram.strategy';

// Lista di tutte le strategie di notifica disponibili
const strategies = [
  TelegramNotificationStrategy,
  // SlackNotificationStrategy,
];

@Global()
@Module({
  imports: [], // ConfigModule è già globale
  providers: [
    NotificationService,
    ...strategies, // Rende disponibili le strategie per l'injection
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
