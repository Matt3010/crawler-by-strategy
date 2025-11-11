import { Module, Global } from '@nestjs/common';
import { NotificationService } from './notification.service';


@Global()
@Module({
    imports: [],
    providers: [
        NotificationService,
    ],
    exports: [NotificationService],
})
export class NotificationModule {}