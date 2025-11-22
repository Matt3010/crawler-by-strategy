import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, FlowProducer, Job } from 'bullmq';
import {DETAIL_QUEUE_NAME, FLOW_PRODUCER, SCAN_QUEUE_NAME, SUMMARY_QUEUE_NAME} from "../../crawler/crawler.constants";


@Injectable()
export class CrawlerQueueClient {
    private readonly logger: Logger = new Logger(CrawlerQueueClient.name);

    constructor(
        @InjectQueue(SCAN_QUEUE_NAME) private readonly scanQueue: Queue,
        @InjectQueue(SUMMARY_QUEUE_NAME) private readonly summaryQueue: Queue,
        @InjectQueue(DETAIL_QUEUE_NAME) private readonly detailQueue: Queue,
        @Inject(FLOW_PRODUCER) private readonly flowProducer: FlowProducer,
    ) {}

    public async cleanAllQueues(): Promise<void> {
        await Promise.all([
            this.scanQueue.clean(0, 5000, 'wait'),
            this.scanQueue.clean(0, 5000, 'delayed'),
            this.scanQueue.clean(0, 5000, 'active'),
            this.summaryQueue.clean(0, 5000, 'wait'),
            this.summaryQueue.clean(0, 5000, 'delayed'),
            this.summaryQueue.clean(0, 5000, 'active'),
            this.detailQueue.clean(0, 5000, 'wait'),
        ]);
        this.logger.debug('All crawler queues cleaned successfully.');
    }

    public async dispatchScanJobs(strategyIds: string[], isCron: boolean): Promise<Job[]> {
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
            data: { strategyId: id, isCron },
            opts: {
                jobId: `scan-${id}-${Date.now()}`,
                removeOnComplete: true,
                removeOnFail: 100
            },
        }));

        return this.scanQueue.addBulk(jobs);
    }

    public async dispatchScrapeFlow(strategyId: string, links: string[], isCron: boolean): Promise<void> {
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
        }[] = links.map((link: string): {
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
                removeOnFail: 20,
                delay: Math.floor(Math.random() * 10000),
            }
        }));

        await this.flowProducer.add({
            name: `summary-${strategyId}`,
            queueName: SUMMARY_QUEUE_NAME,
            data: {
                strategyId,
                isCron,
                totalChildren: childrenJobs.length
            },
            opts: {
                removeOnComplete: true,
                removeOnFail: 10,
            },
            children: childrenJobs,
        });

        this.logger.log(`[${strategyId}] Flow dispatched: 1 Summary waiting for ${childrenJobs.length} Details.`);
    }
}