import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DETAIL_QUEUE_NAME } from './crawler.constants';
import { LogService } from 'src/log/log.service';
import {
    ICrawlerStrategy,
    ProcessResult,
} from './strategies/crawler.strategy.interface';
import { DimmiCosaCerchiStrategy } from './strategies/dimmi-cosa-cerchi-strategy.service';

export type CrawlStatus = 'created' | 'updated' | 'unchanged' | 'error';
export type DetailJobResult = ProcessResult;

@Processor(DETAIL_QUEUE_NAME)
@Injectable()
export class DetailWorker extends WorkerHost {
    private readonly logger = new Logger(DetailWorker.name);
    private readonly strategies: Map<string, ICrawlerStrategy> = new Map();

    constructor(
        private readonly logService: LogService,
        private readonly dimmicosacerchi: DimmiCosaCerchiStrategy,
    ) {
        super();
        this.strategies.set(this.dimmicosacerchi.getStrategyId(), this.dimmicosacerchi);
    }

    private readonly createLogger = (jobId: string | number) => {
        return (message: string) => {
            const logMsg = `[Job ${jobId}] ${message}`;
            this.logger.log(logMsg);
            this.logService.add(logMsg);
        };
    }

    async process(job: Job<{ strategyId: string, link: string }>): Promise<DetailJobResult> {
        const { strategyId, link } = job.data;
        const log = this.createLogger(job.id);

        log(`Avvio scraping dettaglio per [${strategyId}]: ${link}`);

        const strategy = this.strategies.get(strategyId);
        if (!strategy) {
            throw new Error(`[Job ${job.id}] Strategia "${strategyId}" non trovata.`);
        }

        const detailData = await strategy.runDetail(link, log);
        const result = await strategy.processDetail(detailData, log);

        log(`Scraping completato: ${link} (Stato: ${result.status})`);

        return result;
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error) {
        const logMsg = `❌ ERRORE DetailWorker: Job [${job.id}] fallito per [${job.data.strategyId}]: ${err.message}`;
        this.logger.error(logMsg, err.stack);
        this.logService.add(logMsg);
    }
}