import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { LogService } from 'src/log/log.service';
import { NotificationService } from 'src/notification/notification.service';
import { SUMMARY_QUEUE_NAME } from './crawler.constants';
import {
    ICrawlerStrategy,
    ProcessResult,
} from './strategies/crawler.strategy.interface';
import { DimmiCosaCerchiStrategy } from './strategies/dimmi-cosa-cerchi-strategy.service';
import {TargetedNotification} from "../notification/notification.types";

type DetailJobResult = ProcessResult;

@Processor(SUMMARY_QUEUE_NAME)
@Injectable()
export class SummaryWorker extends WorkerHost {
    private readonly logger: Logger = new Logger(SummaryWorker.name);
    private readonly strategies: Map<string, ICrawlerStrategy> = new Map();

    constructor(
        private readonly logService: LogService,
        private readonly notificationService: NotificationService,
        private readonly dimmicosacerchi: DimmiCosaCerchiStrategy,
    ) {
        super();
        this.strategies.set(
            this.dimmicosacerchi.getStrategyId(),
            this.dimmicosacerchi,
        );
    }

    async process(job: Job<{ strategyId: string, isCron: boolean, totalChildren: number }>): Promise<void> {
        const { strategyId, isCron, totalChildren } = job.data;
        const log: (message: string) => void = (message: string) => {
            this.logger.log(message);
            this.logService.add(message);
        }

        log(`[Job ${job.id}] Avvio riepilogo per [${strategyId}]...`);

        const strategy: ICrawlerStrategy = this.strategies.get(strategyId);
        if (!strategy) {
            const errorMsg = `❌ ERRORE CRITICO: Strategia [${strategyId}] non trovata nel SummaryWorker. Impossibile generare il riepilogo.`;
            log(errorMsg);
            await this.notificationService.sendNotification(errorMsg);
            return;
        }

        const completedValues: { [p: string]: DetailJobResult } = await job.getChildrenValues<DetailJobResult>();
        const completedResults: DetailJobResult[] = Object.values(completedValues);
        const failedCount: number = totalChildren - completedResults.length;

        const targetedNotification: TargetedNotification = strategy.formatSummary(
            completedResults,
            totalChildren,
            failedCount,
            strategyId,
        );

        log(targetedNotification.payload.message);
        await this.notificationService.sendTargetedNotification(
            targetedNotification
        );

        if (isCron) {
            log(`[${strategyId}] ha completato la sua parte di CRON.`);
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error): void {
        const logMsg = `❌ ERRORE CRITICO SummaryWorker: Job [${job.id}] fallito: ${err.message}`;
        this.logger.error(logMsg, err.stack);
        this.logService.add(logMsg);
        this.notificationService.sendNotification(logMsg);
    }
}