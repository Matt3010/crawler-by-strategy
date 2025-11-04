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

export type DetailJobResult = ProcessResult;

@Processor(DETAIL_QUEUE_NAME)
@Injectable()
export class DetailWorker extends WorkerHost {
    private readonly logger: Logger = new Logger(DetailWorker.name);
    private readonly strategies: Map<string, ICrawlerStrategy> = new Map();

    constructor(
        private readonly logService: LogService,
        private readonly dimmicosacerchi: DimmiCosaCerchiStrategy,
    ) {
        super();
        this.strategies.set(this.dimmicosacerchi.getStrategyId(), this.dimmicosacerchi);
    }

    private readonly createLogger: (jobId: (string | number)) => (message: string) => void = (jobId: string | number): (message: string) => void => {
        return (message: string): void => {
            const logMsg = `[Job ${jobId}] ${message}`;
            this.logger.log(logMsg);
            this.logService.add(logMsg);
        };
    }

    async process(job: Job<{ strategyId: string, link: string }>): Promise<DetailJobResult> {
        const { strategyId, link } = job.data;
        const log: (message: string) => void = this.createLogger(job.id);

        log(`Avvio scraping dettaglio per [${strategyId}]: ${link}`);

        const strategy: ICrawlerStrategy = this.strategies.get(strategyId);
        if (!strategy) {
            throw new Error(`[Job ${job.id}] Strategia "${strategyId}" non trovata.`);
        }

        const detailData: any = await strategy.runDetail(link, log);
        const result: ProcessResult = await strategy.processDetail(detailData, log);

        log(`Scraping completato: ${link} (Stato: ${result.status})`);

        return result;
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error): void {
        const logMsg = `❌ ERRORE DetailWorker: Job [${job.id}] fallito per [${job.data.strategyId}]: ${err.message}`;
        this.logger.error(logMsg, err.stack);
        this.logService.add(logMsg);
    }
}