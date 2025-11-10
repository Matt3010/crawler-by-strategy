import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import {Job, Queue, QueueEvents} from 'bullmq';
import { LogService } from 'src/log/log.service';
import { NotificationService } from 'src/notification/notification.service';
import { SCAN_QUEUE_NAME, SUMMARY_QUEUE_NAME } from './crawler.constants';

@Injectable()
export class CrawlerService implements OnModuleDestroy {
    private readonly logger: Logger = new Logger(CrawlerService.name);

    private readonly scanQueueEvents: QueueEvents;

    public constructor(
        @InjectQueue(SCAN_QUEUE_NAME) private readonly scanQueue: Queue,
        @InjectQueue(SUMMARY_QUEUE_NAME) private readonly summaryQueue: Queue,
        private readonly configService: ConfigService,
        private readonly logService: LogService,
        private readonly notificationService: NotificationService,
    ) {
        const connection = {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
        };
        this.scanQueueEvents = new QueueEvents(SCAN_QUEUE_NAME, { connection });
        this.scanQueueEvents.setMaxListeners(20);
    }

    @Cron(CronExpression.EVERY_DAY_AT_8AM)
    public async runDimmiCosaCerchiCron(): Promise<void> {
        const strategyId = 'dimmicosacerchi';
        this.logger.warn(`--- CRON JOB AVVIATO [${strategyId}] ---`);
        const msg = `--- 🏁 CRON JOB AVVIATO (schedulato) [${strategyId}] ---`;
        await this.logService.add(msg);

        await this.logService.clear();

        await this.startCrawl([strategyId], true);
    }

    public async forceCrawl(): Promise<any> {
        this.logger.log('--- CRAWL FORZATO AVVIATO ---');
        const msg = '--- 🚀 CRAWL FORZATO AVVIATO (manuale) ---';
        await this.logService.add(msg);
        await this.logService.clear();

        const activeStrategies: string[] = this.getActiveStrategies();
        await this.startCrawl(activeStrategies, false);

        return { message: `Crawl forzato avviato per ${activeStrategies.length} strategie. I task sono stati aggiunti alla coda.` };
    }

    private getActiveStrategies(): string[] {
        return (this.configService.get<string>('ACTIVE_STRATEGIES') || '')
            .split(',')
            .filter((id: string): boolean => id.trim().length > 0);
    }

    private async startCrawl(strategyIds: string[], isCron: boolean): Promise<void> {

        if (strategyIds.length === 0) {
            const msg = '❌ ERRORE: Chiamato startCrawl senza strategie da avviare.';
            this.logger.warn(msg);
            await this.logService.add(msg);
            if(!isCron) {
                await this.notificationService.sendNotification(msg);
            }
            return;
        }

        await this.scanQueue.clean(0, 5000, 'wait');
        await this.scanQueue.clean(0, 5000, 'delayed');
        await this.scanQueue.clean(0, 5000, 'active');
        await this.summaryQueue.clean(0, 5000, 'wait');
        await this.summaryQueue.clean(0, 5000, 'delayed');
        await this.summaryQueue.clean(0, 5000, 'active');

        const jobs: {
            name: string;
            data: { strategyId: string; isCron: boolean };
            opts: { jobId: string; removeOnComplete: boolean; removeOnFail: number }
        }[] = strategyIds.map((id: string): {
            name: "scan-strategy";
            data: { strategyId: string; isCron: boolean };
            opts: { jobId: string; removeOnComplete: boolean; removeOnFail: number }
        } => ({
            name: 'scan-strategy',
            data: {
                strategyId: id,
                isCron: isCron
            },
            opts: {
                jobId: `scan-${id}`,
                removeOnComplete: true,
                removeOnFail: 100,
            }
        }));

        const createdJobs: Job[] = await this.scanQueue.addBulk(jobs);
        const logMsg = `Aggiunti ${createdJobs.length} job di scansione (Flows) alla coda [${SCAN_QUEUE_NAME}]`;
        this.logger.log(logMsg);
        await this.logService.add(logMsg);

        if (isCron) {
            this.logger.log('In attesa del completamento del dispatch (ScanJobs)...');

            const results: PromiseSettledResult<unknown>[] = await Promise.allSettled(
                createdJobs.map((job: Job): Promise<unknown> => job.waitUntilFinished(this.scanQueueEvents))
            );

            let failedDispatches: number = 0;
            results.forEach((r: PromiseSettledResult<unknown>, idx: number): void => {
                if (r.status === 'rejected') {
                    failedDispatches++;
                    this.logService.add(`❌ ERRORE CRITICO: Dispatch [${strategyIds[idx]}] fallita: ${r.reason?.message}`);
                }
            });

            const summaryMsg = `--- ✅ DISPATCH CRON COMPLETATO ---
        - Strategie inviate: ${createdJobs.length}
        - Dispatch falliti: ${failedDispatches}
        (I riepiloghi arriveranno al termine dei job)`;

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