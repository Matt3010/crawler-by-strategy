import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramClient } from './telegram/telegram.client';
import {ActivitySyncClient} from "./activities/activity-sync.client";
import {WebScraperClient} from "./crawler/web-scraper.client";

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        TelegramClient,
        ActivitySyncClient,
        WebScraperClient
    ],
    exports: [
        TelegramClient,
        ActivitySyncClient,
        WebScraperClient
    ],
})
export class CommonModule {}