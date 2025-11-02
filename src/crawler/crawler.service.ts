import { Injectable, Logger, Inject, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { LogService } from 'src/log/log.service';
import { NotificationService } from 'src/notification/notification.service';
import { SCAN_QUEUE_NAME, SUMMARY_QUEUE_NAME } from './crawler.constants';

@Injectable()
export class CrawlerService implements OnModuleDestroy {
  private readonly logger = new Logger(CrawlerService.name);

  // Manteniamo QueueEvents SOLO per la ScanQueue, per sapere quando il "dispatch" è finito.
  private scanQueueEvents: QueueEvents;

  constructor(
    @InjectQueue(SCAN_QUEUE_NAME) private scanQueue: Queue,
    @InjectQueue(SUMMARY_QUEUE_NAME) private summaryQueue: Queue, // Per pulire
    private readonly configService: ConfigService,
    private readonly logService: LogService,
    private readonly notificationService: NotificationService,
  ) {
    // Inizializza QueueEvents manualmente
    const connection = {
      host: configService.get<string>('REDIS_HOST', 'localhost'),
      port: configService.get<number>('REDIS_PORT', 6379),
    };
    this.scanQueueEvents = new QueueEvents(SCAN_QUEUE_NAME, { connection });

    // --- FIX v32 ---
    // L'oggetto 'QueueEvents' È l'event emitter.
    this.scanQueueEvents.setMaxListeners(20); // Limite basso, solo per le strategie
    // --- FINE FIX ---
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.warn('--- CRON JOB AVVIATO ---');
    const msg = '--- 🏁 CRON JOB AVVIATO (schedulato) ---';
    this.logService.add(msg);
    this.notificationService.sendNotification(msg);
    await this.logService.clear();
    await this.startCrawl(true);
  }

  async forceCrawl(): Promise<any> {
    this.logger.log('--- CRAWL FORZATO AVVIATO ---');
    const msg = '--- 🚀 CRAWL FORZATO AVVIATO (manuale) ---';
    this.logService.add(msg);
    this.notificationService.sendNotification(msg);
    await this.logService.clear();
    await this.startCrawl(false); // Non attende il completamento
    return { message: 'Crawl avviato. I task sono stati aggiunti alla coda.' };
  }

  private async startCrawl(waitForCompletion = false): Promise<void> {
    const activeStrategiesIds = (this.configService.get<string>('ACTIVE_STRATEGIES') || '')
      .split(',')
      .filter(id => id.trim().length > 0);

    if (activeStrategiesIds.length === 0) {
      const msg = '❌ ERRORE: Nessuna strategia attiva in .env (ACTIVE_STRATEGIES).';
      this.logger.warn(msg);
      this.logService.add(msg);
      this.notificationService.sendNotification(msg);
      return;
    }

    // Pulisce le code prima di iniziare
    await this.scanQueue.clean(0, 5000, 'wait');
    await this.scanQueue.clean(0, 5000, 'delayed');
    await this.scanQueue.clean(0, 5000, 'active');
    await this.summaryQueue.clean(0, 5000, 'wait');
    await this.summaryQueue.clean(0, 5000, 'delayed');
    await this.summaryQueue.clean(0, 5000, 'active');

    const jobs = activeStrategiesIds.map(id => ({
      name: 'scan-strategy',
      data: {
        strategyId: id,
        isCron: waitForCompletion // Passa l'info se è un cron
      },
      opts: {
        jobId: `scan-${id}`,
        removeOnComplete: true,
        removeOnFail: 100,
      }
    }));

    const createdJobs = await this.scanQueue.addBulk(jobs);
    const logMsg = `Aggiunti ${createdJobs.length} job di scansione (Flows) alla coda [${SCAN_QUEUE_NAME}]`;
    this.logger.log(logMsg);
    this.logService.add(logMsg);

    if (waitForCompletion) {
      this.logger.log('In attesa del completamento del dispatch (ScanJobs)...');

      const results = await Promise.allSettled(
        createdJobs.map(job => job.waitUntilFinished(this.scanQueueEvents))
      );

      let failedDispatches = 0;
      results.forEach((r, idx) => {
        if (r.status === 'rejected') {
          failedDispatches++;
          this.logService.add(`❌ ERRORE CRITICO: Dispatch [${activeStrategiesIds[idx]}] fallita: ${r.reason?.message}`);
        }
      });

      // Questo messaggio ora significa "Creazione dei Flow completata"
      const summaryMsg = `--- ✅ DISPATCH CRON COMPLETATO ---
- Strategie inviate: ${createdJobs.length}
- Dispatch falliti: ${failedDispatches}
(I riepiloghi arriveranno al termine dei job)`;

      this.logger.log(summaryMsg);
      this.logService.add(summaryMsg);
      this.notificationService.sendNotification(summaryMsg);
    }
  }

  async getLogs(count = 100): Promise<string[]> {
    return this.logService.get(count);
  }

  async onModuleDestroy() {
    await this.scanQueueEvents.close();
  }
}
