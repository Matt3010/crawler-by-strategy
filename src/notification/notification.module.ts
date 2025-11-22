import { Module, Global } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CommonModule } from '../common/common.module';

@Global()
@Module({
    imports: [CommonModule],
    providers: [NotificationService],
    exports: [NotificationService],
})
export class NotificationModule {}