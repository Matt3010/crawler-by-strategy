import {OnWorkerEvent, Processor, WorkerHost} from '@nestjs/bullmq';
import {FlowProducer, Job} from 'bullmq';
import {Inject, Injectable, Logger} from '@nestjs/common';
import {ICrawlerStrategy} from './strategies/crawler.strategy.interface';
import {LogService} from 'src/log/log.service';
import {NotificationService} from 'src/notification/notification.service';
import {DETAIL_QUEUE_NAME, FLOW_PRODUCER, SCAN_QUEUE_NAME, SUMMARY_QUEUE_NAME} from './crawler.constants';
import { StrategyRegistry } from './strategy.registry.service';

@Processor(SCAN_QUEUE_NAME)
@Injectable()
export class ScanWorker extends WorkerHost {
    private readonly logger: Logger = new Logger(ScanWorker.name);

    constructor(
        @Inject(FLOW_PRODUCER) private readonly flowProducer: FlowProducer,
        private readonly logService: LogService,
        private readonly notificationService: NotificationService,
        private readonly registry: StrategyRegistry,
    ) {
        super();
    }

    private readonly createLogger: (jobId: (string | number)) => (message: string) => void = (jobId: string | number): (message: string) => void => {
        return (message: string): void => {
            const logMsg = `[Job ${jobId}] ${message}`;
            this.logger.log(logMsg);
            this.logService.add(logMsg);
        };
    }

    async process(job: Job<{ strategyId: string, isCron: boolean }>): Promise<void> {
        const log: (message: string) => void = this.createLogger(job.id || 'scan');
        const { strategyId, isCron } = job.data;
        log(`Scan job received for [${strategyId}]...`);

        const strategy: ICrawlerStrategy = this.registry.get(strategyId); // <-- Modificato
        if (!strategy) throw new Error(`Strategy "${strategyId}" not found.`);

        const targetUrl: string = strategy.getBaseUrl();
        if (!targetUrl) throw new Error(`No base URL defined for [${strategyId}]`);

        const detailLinks: string[] = await strategy.runListing(log, targetUrl);

        if (detailLinks.length === 0) {
            log(`No links found for [${strategyId}]. Scan finished.`);
            return;
        }

        const childrenJobs: {
            name: string;
            data: { strategyId: string; link: string };
            queueName: string;
            opts: {
                attempts: number;
                backoff: { type: string; delay: number };
                removeOnComplete: boolean;
                removeOnFail: number;
                delay: number
            }
        }[] = detailLinks.map((link: string): {
            name: "scrape-detail";
            data: { strategyId: string; link: string };
            queueName: string;
            opts: {
                attempts: number;
                backoff: { type: string; delay: number };
                removeOnComplete: boolean;
                removeOnFail: number;
                delay: number
            }
        } => ({
            name: 'scrape-detail',
            data: { strategyId, link },
            queueName: DETAIL_QUEUE_NAME,
            opts: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
                removeOnComplete: true,
                removeOnFail: 10,
                delay: Math.floor(Math.random() * 30000),
            }
        }));

        await this.flowProducer.add({
            name: `summary-${strategyId}`,
            queueName: SUMMARY_QUEUE_NAME,
            data: {
                strategyId: strategyId,
                isCron: isCron,
                totalChildren: childrenJobs.length
            },
            opts: {
                removeOnComplete: true,
                removeOnFail: 5,
            },
            children: childrenJobs,
        });

        log(`Flow created: 1 summary job [${SUMMARY_QUEUE_NAME}] waiting for ${childrenJobs.length} child jobs [${DETAIL_QUEUE_NAME}].`);
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error): void {
        const logMsg = `❌ ERROR ScanWorker: Job [${job.id}] failed for [${job.data.strategyId}]: ${err.message}`;
        this.logger.error(logMsg, err.stack);
        this.logService.add(logMsg);

        const notifyMsg = `❌ CRITICAL ERROR: Scan for [${job.data.strategyId}] could not start: ${err.message}. The entire process for this strategy failed.`;
        this.notificationService.sendNotification(notifyMsg);
    }
}