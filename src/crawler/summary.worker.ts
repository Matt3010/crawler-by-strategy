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
import { TargetedNotification } from "../notification/notification.types";
import { StrategyRegistry } from './strategy.registry.service';

type DetailJobResult = ProcessResult;

@Processor(SUMMARY_QUEUE_NAME)
@Injectable()
export class SummaryWorker extends WorkerHost {
    private readonly logger: Logger = new Logger(SummaryWorker.name);

    constructor(
        private readonly logService: LogService,
        private readonly notificationService: NotificationService,
        private readonly registry: StrategyRegistry,
    ) {
        super();
    }

    async process(job: Job<{ strategyId: string, isCron: boolean, totalChildren: number }>): Promise<void> {
        const { strategyId, isCron, totalChildren } = job.data;
        const log: (message: string) => void = (message: string) => {
            this.logger.log(message);
            this.logService.add(message);
        }

        log(`[Job ${job.id}] Starting summary for [${strategyId}]...`);

        const strategy: ICrawlerStrategy = this.registry.get(strategyId); // <-- Modificato
        if (!strategy) {
            const errorMsg = `❌ CRITICAL ERROR: Strategy [${strategyId}] not found in SummaryWorker. Unable to generate summary.`;
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
            log(`[${strategyId}] has completed its part of the CRON job.`);
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error): void {
        const logMsg = `❌ CRITICAL ERROR SummaryWorker: Job [${job.id}] failed: ${err.message}`;
        this.logger.error(logMsg, err.stack);
        this.logService.add(logMsg);
        this.notificationService.sendNotification(logMsg);
    }
}