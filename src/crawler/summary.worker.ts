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

type DetailJobResult = ProcessResult<any>;

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
        const log: (message: string) => void = (message: string): void => {
            this.logger.log(message);
            this.logService.add(message);
        }

        log(`[Job ${job.id}] Starting summary for [${strategyId}]...`);

        const strategy: ICrawlerStrategy = this.registry.get(strategyId);
        if (!strategy) {
            const errorMsg: string = `❌ CRITICAL ERROR: Strategy [${strategyId}] not found in SummaryWorker. Unable to generate summary.`;
            log(errorMsg);
            await this.notificationService.sendNotification(errorMsg);
            return;
        }

        const completedValues: { [p: string]: DetailJobResult } = await job.getChildrenValues<DetailJobResult>();
        const completedResults: DetailJobResult[] = Object.values(completedValues);
        const failedCount: number = totalChildren - completedResults.length;

        const targetedNotification: TargetedNotification | null = strategy.formatSummary(
            completedResults,
            totalChildren,
            failedCount,
            strategyId,
        );

        if (targetedNotification) {
            log(targetedNotification.payload.message);
            await this.notificationService.sendTargetedNotification(
                targetedNotification
            );
        } else {
            log(`[${strategyId}] Summary notification suppressed (no new/updated/failed items).`);
        }

        if (isCron) {
            log(`[${strategyId}] has completed its part of the CRON job.`);
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job, err: Error): void {
        const logMsg: string = `❌ CRITICAL ERROR SummaryWorker: Job [${job.id}] failed: ${err.message}`;
        this.logger.error(logMsg, err.stack);
        this.logService.add(logMsg);
        this.notificationService.sendNotification(logMsg);
    }
}