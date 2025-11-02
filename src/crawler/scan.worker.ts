import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job, FlowProducer } from 'bullmq';
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ICrawlerStrategy } from './strategies/crawler.strategy.interface';
import { DimmiCosaCerchiStrategy } from './strategies/dimmi-cosa-cerchi-strategy.service';
import { LogService } from 'src/log/log.service';
import { NotificationService } from 'src/notification/notification.service';
import {
  SCAN_QUEUE_NAME,
  DETAIL_QUEUE_NAME,
  SUMMARY_QUEUE_NAME,
  FLOW_PRODUCER
} from './crawler.constants';

@Processor(SCAN_QUEUE_NAME)
@Injectable()
export class ScanWorker extends WorkerHost {
  private readonly logger = new Logger(ScanWorker.name);
  private strategies: Map<string, ICrawlerStrategy> = new Map();

  constructor(
    @Inject(FLOW_PRODUCER) private readonly flowProducer: FlowProducer,
    private readonly logService: LogService,
    private readonly notificationService: NotificationService,
    private readonly dimmicosacerchi: DimmiCosaCerchiStrategy,
  ) {
    super();
    this.strategies.set(this.dimmicosacerchi.getStrategyId(), this.dimmicosacerchi);
  }

  private createLogger = (jobId: string | number) => {
    return (message: string) => {
      const logMsg = `[Job ${jobId}] ${message}`;
      this.logger.log(logMsg);
      this.logService.add(logMsg);
    };
  }

  /**
   * AGGIORNATO: Non attende, crea un Flow con un job di riepilogo
   */
  async process(job: Job<{ strategyId: string, isCron: boolean }>): Promise<void> {
    const log = this.createLogger(job.id || 'scan');
    const { strategyId, isCron } = job.data;
    log(`Ricevuto job di scansione per [${strategyId}]...`);

    const strategy = this.strategies.get(strategyId);
    if (!strategy) throw new Error(`Strategia "${strategyId}" non trovata.`);

    const targetUrl = strategy.getBaseUrl();
    if (!targetUrl) throw new Error(`Nessun URL base definito per [${strategyId}]`);

    const detailLinks = await strategy.runListing(log, targetUrl);

    if (detailLinks.length === 0) {
        log(`Nessun link trovato per [${strategyId}]. Scansione terminata.`);
        return;
    }

    // 1. Prepara i job figli (DetailWorker)
    const childrenJobs = detailLinks.map(link => ({
      name: 'scrape-detail',
      data: { strategyId, link },
      queueName: DETAIL_QUEUE_NAME,
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 10,
      }
    }));

    // 2. Crea il flow: 1 job di riepilogo che dipende dai job figli
    await this.flowProducer.add({
      name: `summary-${strategyId}`,
      queueName: SUMMARY_QUEUE_NAME,
      data: {
        strategyId: strategyId,
        isCron: isCron, // Passa l'info se è un cron job
        totalChildren: childrenJobs.length
      },
      opts: {
        removeOnComplete: true,
        removeOnFail: 5,
      },
      children: childrenJobs,
    });

    log(`Flow creato: 1 job di riepilogo [${SUMMARY_QUEUE_NAME}] in attesa di ${childrenJobs.length} job figli [${DETAIL_QUEUE_NAME}].`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    const logMsg = `❌ ERRORE ScanWorker: Job [${job.id}] fallito per [${job.data.strategyId}]: ${err.message}`;
    this.logger.error(logMsg, err.stack);
    this.logService.add(logMsg);
    this.notificationService.sendNotification(logMsg);
  }
}
