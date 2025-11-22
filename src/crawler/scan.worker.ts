import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ICrawlerStrategy } from './strategies/crawler.strategy.interface';
import { LogService } from 'src/log/log.service';
import { NotificationService } from 'src/notification/notification.service';
import { SCAN_QUEUE_NAME } from './crawler.constants';
import { StrategyRegistry } from './strategy.registry.service';
import {CrawlerQueueClient} from "../common/crawler/crawler-queue.client";

@Processor(SCAN_QUEUE_NAME)
@Injectable()
export class ScanWorker extends WorkerHost {
    private readonly logger: Logger = new Logger(ScanWorker.name);

    constructor(
        private readonly logService: LogService,
        private readonly notificationService: NotificationService,
        private readonly registry: StrategyRegistry,
        private readonly queueClient: CrawlerQueueClient,
    ) {
        super();
    }

    private readonly createLogger: (jobId: (string | number)) => (message: string) => void = (jobId: string | number): (message: string) => void => (message: string): void => {
        const logMsg = `[Job ${jobId}] ${message}`;
        this.logger.log(logMsg);
        this.logService.add(logMsg);
    };

    async process(job: Job<{ strategyId: string, isCron: boolean }>): Promise<void> {
        const log: (message: string) => void = this.createLogger(job.id || 'scan');
        const { strategyId, isCron } = job.data;
        log(`Scan job received for [${strategyId}]...`);

        const strategy: ICrawlerStrategy = this.registry.get(strategyId);
        if (!strategy) throw new Error(`Strategy "${strategyId}" not found.`);

        const targetUrl: string = strategy.getBaseUrl();
        if (!targetUrl) throw new Error(`No base URL defined for [${strategyId}]`);

        const detailLinks: string[] = await strategy.runListing(log, targetUrl);

        if (detailLinks.length === 0) {
            log(`No links found for [${strategyId}]. Scan finished.`);
            return;
        }

        await this.queueClient.dispatchScrapeFlow(strategyId, detailLinks, isCron);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error): void {
        const logMsg = `❌ ERROR ScanWorker: Job [${job.id}] failed for [${job.data.strategyId}]: ${err.message}`;
        this.logger.error(logMsg, err.stack);
        this.logService.add(logMsg);

        const notifyMsg = `❌ CRITICAL ERROR: Scan for [${job.data.strategyId}] failed: ${err.message}.`;
        this.notificationService.sendNotification(notifyMsg);
    }
}