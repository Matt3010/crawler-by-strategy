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

  constructor(
    @InjectQueue(SCAN_QUEUE_NAME) private scanQueue: Queue,
    @InjectQueue(SUMMARY_QUEUE_NAME) private summaryQueue: Queue,
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

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron(): Promise<void> {
    this.logger.warn('--- CRON JOB AVVIATO ---');
    const msg = '--- 🏁 CRON JOB AVVIATO (schedulato) ---';
    await this.logService.add(msg);
    await this.logService.clear();
    await this.startCrawl(true);
  }

  async forceCrawl(): Promise<any> {
    this.logger.log('--- CRAWL FORZATO AVVIATO ---');
    const msg = '--- 🚀 CRAWL FORZATO AVVIATO (manuale) ---';
    await this.logService.add(msg);
    await this.logService.clear();
    await this.startCrawl(false);
    return { message: 'Crawl avviato. I task sono stati aggiunti alla coda.' };
  }

  private async startCrawl(waitForCompletion = false): Promise<void> {
    const activeStrategiesIds: string[] = (this.configService.get<string>('ACTIVE_STRATEGIES') || '')
      .split(',')
      .filter((id: string): boolean => id.trim().length > 0);

    if (activeStrategiesIds.length === 0) {
      const msg = '❌ ERRORE: Nessuna strategia attiva in .env (ACTIVE_STRATEGIES).';
      this.logger.warn(msg);
      await this.logService.add(msg);
      await this.notificationService.sendNotification(msg);
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
    }[] = activeStrategiesIds.map((id: string): {
        name: "scan-strategy";
        data: { strategyId: string; isCron: boolean };
        opts: { jobId: string; removeOnComplete: boolean; removeOnFail: number }
    } => ({
      name: 'scan-strategy',
      data: {
        strategyId: id,
        isCron: waitForCompletion
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
    this.logService.add(logMsg);

    if (waitForCompletion) {
      this.logger.log('In attesa del completamento del dispatch (ScanJobs)...');

      const results: PromiseSettledResult<unknown>[] = await Promise.allSettled(
        createdJobs.map((job: Job): Promise<unknown> => job.waitUntilFinished(this.scanQueueEvents))
      );

      let failedDispatches: number = 0;
      results.forEach((r: PromiseSettledResult<unknown>, idx: number): void => {
        if (r.status === 'rejected') {
          failedDispatches++;
          this.logService.add(`❌ ERRORE CRITICO: Dispatch [${activeStrategiesIds[idx]}] fallita: ${r.reason?.message}`);
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

  async getLogs(count = 100): Promise<string[]> {
    return this.logService.get(count);
  }

  async onModuleDestroy(): Promise<void> {
    await this.scanQueueEvents.close();
  }
}