import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Concorso } from '../concorsi/entities/concorso.entity';
import { CrawlConcorsoDto } from '../concorsi/dto/crawl-concorso.dto';

import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DETAIL_QUEUE_NAME } from './crawler.constants';
import { LogService } from 'src/log/log.service';
import { NotificationService } from 'src/notification/notification.service';
import { ICrawlerStrategy } from './strategies/crawler.strategy.interface';
import { DimmiCosaCerchiStrategy } from './strategies/dimmi-cosa-cerchi-strategy.service';

// Questo tipo è inferito dal DetailWorker
export type CrawlStatus = 'created' | 'updated' | 'unchanged' | 'error';

// Tipo di ritorno per il job, usato dal SummaryWorker
type DetailJobResult = {
  status: CrawlStatus;
  concorso: Concorso;
};

@Processor(DETAIL_QUEUE_NAME)
@Injectable()
export class DetailWorker extends WorkerHost {
  private readonly logger = new Logger(DetailWorker.name);
  private strategies: Map<string, ICrawlerStrategy> = new Map();

  constructor(
    @InjectRepository(Concorso)
    private readonly concorsoRepository: Repository<Concorso>,

    // Injections per il worker
    private readonly logService: LogService,
    private readonly notificationService: NotificationService,
    private readonly dimmicosacerchi: DimmiCosaCerchiStrategy,
  ) {
    super();
    // Popola la mappa delle strategie
    this.strategies.set(this.dimmicosacerchi.getStrategyId(), this.dimmicosacerchi);
  }

  // Helper per il logging
  private createLogger = (jobId: string | number) => {
    return (message: string) => {
      const logMsg = `[Job ${jobId}] ${message}`;
      this.logger.log(logMsg);
      this.logService.add(logMsg);
    };
  }

  /**
   * Metodo principale del worker, chiamato da BullMQ
   * per ogni job nella 'detail-queue'.
   */
  async process(job: Job<{ strategyId: string, link: string }>): Promise<DetailJobResult> {
    const { strategyId, link } = job.data;
    const log = this.createLogger(job.id);

    log(`Avvio scraping dettaglio per [${strategyId}]: ${link}`);

    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new Error(`[Job ${job.id}] Strategia "${strategyId}" non trovata.`);
    }

    // 1. Esegui lo scraping
    const dto = await strategy.runDetail(link, log);

    // 2. Salva/Aggiorna nel DB
    const result = await this.createOrUpdateFromCrawl({
      ...dto,
      brand: strategyId,
    });

    log(`Scraping completato: ${link} (Stato: ${result.status})`);

    // 3. Ritorna il risultato per il SummaryWorker
    return result;
  }


  /**
   * Crea o aggiorna un concorso in base ai dati di crawling.
   * Chiamato da `process()`.
   */
  async createOrUpdateFromCrawl(
    concorsoDto: CrawlConcorsoDto,
  ): Promise<DetailJobResult> {

    // 1. Cerca se il concorso esiste già
    const existingConcorso = await this.concorsoRepository.findOneBy({
      sourceId: concorsoDto.sourceId,
    });

    // 2. SE ESISTE GIÀ (Logica di aggiornamento)
    if (existingConcorso) {

      // Fix per le date da stringa a Oggetto Date
      if (existingConcorso.startDate && typeof existingConcorso.startDate === 'string') {
        existingConcorso.startDate = new Date(existingConcorso.startDate);
      }
      if (existingConcorso.endDate && typeof existingConcorso.endDate === 'string') {
        existingConcorso.endDate = new Date(existingConcorso.endDate);
      }

      // 3. Confronto
      const hasChanges =
        existingConcorso.title !== concorsoDto.title ||
        existingConcorso.description !== concorsoDto.description ||
        existingConcorso.rulesUrl !== concorsoDto.rulesUrl ||
        existingConcorso.startDate.toISOString() !== concorsoDto.startDate.toISOString() ||
        existingConcorso.endDate.toISOString() !== concorsoDto.endDate.toISOString();

      if (!hasChanges) {
        // Se non ci sono modifiche
        existingConcorso.crawledAt = new Date();
        const saved = await this.concorsoRepository.save(existingConcorso);
        return { status: 'unchanged', concorso: saved };
      }

      // 4. Se ci sono modifiche, fai il merge
      const updatedConcorso = this.concorsoRepository.merge(
        existingConcorso,
        concorsoDto,
        { crawledAt: new Date() },
      );

      const saved = await this.concorsoRepository.save(updatedConcorso);
      this.logger.log(`Concorso aggiornato: ${saved.title}`);
      return { status: 'updated', concorso: saved };
    }

    // 5. SE NON ESISTE (Logica di creazione)
    const newConcorso = this.concorsoRepository.create({
      ...concorsoDto,
      crawledAt: new Date(),
    });

    const saved = await this.concorsoRepository.save(newConcorso);
    this.logger.log(`Concorso creato: ${saved.title}`);
    return { status: 'created', concorso: saved };
  }

  // --- Gestore Errori Worker ---
  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    const logMsg = `❌ ERRORE DetailWorker: Job [${job.id}] fallito per [${job.data.strategyId}]: ${err.message}`;
    this.logger.error(logMsg, err.stack);
    this.logService.add(logMsg);
  }
}