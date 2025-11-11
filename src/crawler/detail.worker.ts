import {Injectable, Logger} from '@nestjs/common';
import {OnWorkerEvent, Processor, WorkerHost} from '@nestjs/bullmq';
import {Job} from 'bullmq';
import {DETAIL_QUEUE_NAME} from './crawler.constants';
import {LogService} from 'src/log/log.service';
import {ICrawlerStrategy, ProcessResult,} from './strategies/crawler.strategy.interface';
import {StrategyRegistry} from './strategy.registry.service';
import {NotificationService} from 'src/notification/notification.service';
import {CrawlConcorsoDto} from 'src/concorsi/dto/crawl-concorso.dto';

export type DetailJobResult = ProcessResult;

@Processor(DETAIL_QUEUE_NAME)
@Injectable()
export class DetailWorker extends WorkerHost {
    private readonly logger: Logger = new Logger(DetailWorker.name);

    constructor(
        private readonly logService: LogService,
        private readonly registry: StrategyRegistry,
        private readonly notificationService: NotificationService,
    ) {
        super();
    }

    private readonly createLogger: (jobId: (string | number)) => (message: string) => void = (jobId: string | number): (message: string) => void => {
        return (message: string): void => {
            const logMsg: string = `[Job ${jobId}] ${message}`;
            this.logger.log(logMsg);
            this.logService.add(logMsg);
        };
    }

    async process(job: Job<{ strategyId: string, link: string }>): Promise<DetailJobResult> {
        const { strategyId, link } = job.data;
        const log: (message: string) => void = this.createLogger(job.id);

        log(`Starting detail scraping for [${strategyId}]: ${link}`);

        const strategy: ICrawlerStrategy | undefined = this.registry.get(strategyId);
        if (!strategy) {
            throw new Error(`[Job ${job.id}] Strategy "${strategyId}" not found.`);
        }

        const detailData: Omit<CrawlConcorsoDto, 'brand'> = await strategy.runDetail(link, log);
        const result: ProcessResult = await strategy.processDetail(detailData, log);

        log(`Scraping completed: ${link} (Status: ${result.status})`);

        if (result.individualNotification) {
            try {
                log(`Sending individual notification for [${strategyId}]...`);
                await this.notificationService.sendTargetedNotification(
                    result.individualNotification
                );
            } catch (e) {
                log(`❌ ERROR Failed to send individual notification: ${e.message}`);
            }
        }

        return {
            status: result.status,
            entity: result.entity,
            individualNotification: undefined,
        };
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error): void {
        const logMsg: string = `❌ ERROR DetailWorker: Job [${job.id}] failed for [${job.data.strategyId}]: ${err.message}`;
        this.logger.error(logMsg, err.stack);
        this.logService.add(logMsg);
    }
}