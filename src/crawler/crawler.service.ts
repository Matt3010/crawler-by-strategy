import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Job, QueueEvents } from 'bullmq';
import { LogService } from 'src/log/log.service';
import { NotificationService } from 'src/notification/notification.service';
import { SCAN_QUEUE_NAME } from './crawler.constants';
import {CrawlerQueueClient} from "../common/crawler/crawler-queue.client";

@Injectable()
export class CrawlerService implements OnModuleDestroy {
    private readonly logger: Logger = new Logger(CrawlerService.name);
    private readonly scanQueueEvents: QueueEvents;

    public constructor(
        private readonly configService: ConfigService,
        private readonly logService: LogService,
        private readonly notificationService: NotificationService,
        private readonly queueClient: CrawlerQueueClient,
    ) {
        const connection = {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
        };
        this.scanQueueEvents = new QueueEvents(SCAN_QUEUE_NAME, { connection });
        this.scanQueueEvents.setMaxListeners(20);
    }

    public getLogger(): Logger {
        return this.logger;
    }

    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    public async runDimmiCosaCerchiCron(): Promise<void> {
        const strategyId = 'dimmicosacerchi';
        this.logger.warn(`--- CRON JOB STARTED [${strategyId}] ---`);
        const msg = `--- 🏁 CRON JOB STARTED (scheduled) [${strategyId}] ---`;
        await this.logService.add(msg);
        await this.logService.clear();
        await this.startCrawl([strategyId], true);
    }

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    public async runDimmiCosaTravelCerchiCron(): Promise<void> {
        const strategyId = 'dimmicosacerchitravel';
        this.logger.warn(`--- CRON JOB STARTED [${strategyId}] ---`);
        const msg = `--- 🏁 CRON JOB STARTED (scheduled) [${strategyId}] ---`;
        await this.logService.add(msg);
        await this.logService.clear();
        await this.startCrawl([strategyId], true);
    }

    @Cron(CronExpression.EVERY_DAY_AT_10AM)
    public async runSoldissimiVinciteCron(): Promise<void> {
        const strategyId = 'soldissimivincite';
        this.logger.warn(`--- CRON JOB STARTED [${strategyId}] ---`);
        const msg = `--- 🏁 CRON JOB STARTED (scheduled) [${strategyId}] ---`;
        await this.logService.add(msg);
        await this.logService.clear();
        await this.startCrawl([strategyId], true);
    }

    public async forceCrawl(): Promise<any> {
        this.logger.log('--- FORCE CRAWL (ALL) STARTED ---');
        const msg = '--- 🚀 FORCE CRAWL STARTED (manual, ALL) ---';
        await this.logService.add(msg);
        await this.logService.clear();

        const activeStrategies: string[] = this.getActiveStrategies();
        await this.startCrawl(activeStrategies, false);

        return { message: `Force crawl started for ${activeStrategies.length} strategies. Jobs have been added to the queue.` };
    }

    public async forceCrawlStrategy(strategyId: string): Promise<any> {
        const activeStrategies: string[] = this.getActiveStrategies();
        if (!activeStrategies.includes(strategyId)) {
            const errorMsg = `Strategy [${strategyId}] not found or not active. Active strategies: ${activeStrategies.join(', ')}`;
            this.logger.warn(errorMsg);
            throw new Error(errorMsg);
        }

        this.logger.log(`--- FORCE CRAWL (SINGLE) STARTED FOR [${strategyId}] ---`);
        const msg = `--- 🚀 FORCE CRAWL STARTED (manual, SINGLE) [${strategyId}] ---`;
        await this.logService.add(msg);
        await this.logService.clear();
        await this.startCrawl([strategyId], false);

        return { message: `Force crawl started for strategy [${strategyId}]. The job has been added to the queue.` };
    }

    private getActiveStrategies(): string[] {
        return (this.configService.get<string>('ACTIVE_STRATEGIES') || '')
            .split(',')
            .filter((id: string): boolean => id.trim().length > 0);
    }

    private async startCrawl(strategyIds: string[], isCron: boolean): Promise<void> {
        if (strategyIds.length === 0) {
            const msg = '❌ ERROR: startCrawl called with no strategies to start.';
            this.logger.warn(msg);
            await this.logService.add(msg);
            if (!isCron) {
                await this.notificationService.sendNotification(msg);
            }
            return;
        }

        await this.queueClient.cleanAllQueues();

        const createdJobs: Job[] = await this.queueClient.dispatchScanJobs(strategyIds, isCron);

        const logMsg = `Added ${createdJobs.length} scan jobs to [${SCAN_QUEUE_NAME}]`;
        this.logger.log(logMsg);
        await this.logService.add(logMsg);

        if (isCron) {
            this.logger.log('Waiting for dispatch completion (ScanJobs)...');
            const results: PromiseSettledResult<any>[] = await Promise.allSettled(
                createdJobs.map((job: Job): Promise<any> => job.waitUntilFinished(this.scanQueueEvents))
            );

            let failedDispatches: number = 0;
            results.forEach((r: PromiseSettledResult<unknown>, idx: number): void => {
                if (r.status === 'rejected') {
                    failedDispatches++;
                    this.logService.add(`❌ CRITICAL ERROR: Dispatch [${strategyIds[idx]}] failed: ${r.reason?.message}`);
                }
            });

            const summaryMsg = `--- ✅ CRON DISPATCH COMPLETED ---
        - Strategies dispatched: ${createdJobs.length}
        - Failed dispatches: ${failedDispatches}
        (Summaries will arrive when jobs are finished)`;

            this.logger.log(summaryMsg);
            await this.logService.add(summaryMsg);
        }
    }

    public async getLogs(count = 100): Promise<string[]> {
        return this.logService.get(count);
    }

    public async onModuleDestroy(): Promise<void> {
        await this.scanQueueEvents.close();
    }
}