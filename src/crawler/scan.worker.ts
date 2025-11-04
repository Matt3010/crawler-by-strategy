import {OnWorkerEvent, Processor, WorkerHost} from '@nestjs/bullmq';
import {FlowProducer, Job} from 'bullmq';
import {Inject, Injectable, Logger} from '@nestjs/common';
import {ICrawlerStrategy} from './strategies/crawler.strategy.interface';
import {DimmiCosaCerchiStrategy} from './strategies/dimmi-cosa-cerchi-strategy.service';
import {LogService} from 'src/log/log.service';
import {NotificationService} from 'src/notification/notification.service';
import {DETAIL_QUEUE_NAME, FLOW_PRODUCER, SCAN_QUEUE_NAME, SUMMARY_QUEUE_NAME} from './crawler.constants';

@Processor(SCAN_QUEUE_NAME)
@Injectable()
export class ScanWorker extends WorkerHost {
  private readonly logger: Logger = new Logger(ScanWorker.name);
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

  private createLogger: (jobId: (string | number)) => (message: string) => void = (jobId: string | number): (message: string) => void => {
    return (message: string): void => {
      const logMsg = `[Job ${jobId}] ${message}`;
      this.logger.log(logMsg);
      this.logService.add(logMsg);
    };
  }

  async process(job: Job<{ strategyId: string, isCron: boolean }>): Promise<void> {
    const log: (message: string) => void = this.createLogger(job.id || 'scan');
    const { strategyId, isCron } = job.data;
    log(`Ricevuto job di scansione per [${strategyId}]...`);

    const strategy: ICrawlerStrategy = this.strategies.get(strategyId);
    if (!strategy) throw new Error(`Strategia "${strategyId}" non trovata.`);

    const targetUrl: string = strategy.getBaseUrl();
    if (!targetUrl) throw new Error(`Nessun URL base definito per [${strategyId}]`);

    const detailLinks: string[] = await strategy.runListing(log, targetUrl);

    if (detailLinks.length === 0) {
      log(`Nessun link trovato per [${strategyId}]. Scansione terminata.`);
      return;
    }

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
    }[] = detailLinks.map((link: string): {
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
        removeOnFail: 10,
        delay: Math.floor(Math.random() * 30000),
      }
    }));

    await this.flowProducer.add({
      name: `summary-${strategyId}`,
      queueName: SUMMARY_QUEUE_NAME,
      data: {
        strategyId: strategyId,
        isCron: isCron,
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
  onFailed(job: Job, err: Error): void {
    const logMsg = `❌ ERRORE ScanWorker: Job [${job.id}] fallito per [${job.data.strategyId}]: ${err.message}`;
    this.logger.error(logMsg, err.stack);
    this.logService.add(logMsg);

    const notifyMsg = `❌ ERRORE CRITICO: La scansione per [${job.data.strategyId}] non è potuta iniziare: ${err.message}. L'intero processo per questa strategia è fallito.`;
    this.notificationService.sendNotification(notifyMsg);
  }
}