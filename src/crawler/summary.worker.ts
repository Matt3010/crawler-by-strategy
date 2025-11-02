import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { LogService } from 'src/log/log.service';
import { NotificationService } from 'src/notification/notification.service';
import { Concorso } from 'src/concorsi/entities/concorso.entity';
import { SUMMARY_QUEUE_NAME } from './crawler.constants';
import { CrawlStatus } from 'src/concorsi/concorsi.service';

// Tipo di ritorno atteso dal DetailWorker
type DetailJobResult = {
  status: CrawlStatus;
  concorso: Concorso;
};

@Processor(SUMMARY_QUEUE_NAME)
@Injectable()
export class SummaryWorker extends WorkerHost {
  private readonly logger = new Logger(SummaryWorker.name);

  constructor(
    private readonly logService: LogService,
    private readonly notificationService: NotificationService,
  ) {
    super();
  }

  /**
   * Esegue il riepilogo DOPO che tutti i job figli (DetailWorker) sono completati.
   */
  async process(job: Job<{ strategyId: string, isCron: boolean, totalChildren: number }>): Promise<void> {
    const { strategyId, isCron, totalChildren } = job.data;
    const log = (message: string) => {
        this.logger.log(message);
        this.logService.add(message);
    }

    log(`[Job ${job.id}] Avvio riepilogo per [${strategyId}]...`);

    // 1. Usa getChildrenValues() per ottenere i *risultati* dei job completati.
    const completedValues = await job.getChildrenValues<DetailJobResult>();
    const completedResults = Object.values(completedValues);

    // 2. Calcola i falliti
    const failedCount = totalChildren - completedResults.length;

    const createdItems: Concorso[] = [];
    const updatedItems: Concorso[] = [];
    const unchangedItems: Concorso[] = []; // NUOVO

    // 3. Smista i risultati
    for (const result of completedResults) {
      if (result.status === 'created') {
        createdItems.push(result.concorso);
      } else if (result.status === 'updated') {
        updatedItems.push(result.concorso);
      } else if (result.status === 'unchanged') {
        unchangedItems.push(result.concorso);
      }
    }

    // Determina l'immagine "eroe"
    let heroImageUrl: string | undefined = undefined;
    if (createdItems.length > 0 && createdItems[0].images?.length > 0) {
      heroImageUrl = createdItems[0].images[0];
    } else if (updatedItems.length > 0 && updatedItems[0].images?.length > 0) {
      heroImageUrl = updatedItems[0].images[0];
    }

    // Costruisci il messaggio di riepilogo
    let summaryMessage = `*Riepilogo Scansione [${strategyId}]*\n\n`;

    if (createdItems.length > 0) {
      summaryMessage += `*✅ NUOVI CONCORSI (${createdItems.length}):*\n`;
      summaryMessage += createdItems.map(c =>
        `- ${c.title} (Scade: ${new Date(c.endDate).toLocaleDateString('it-IT')})`
      ).join('\n');
      summaryMessage += `\n\n`;
    }

    if (updatedItems.length > 0) {
      summaryMessage += `*🔄 CONCORSI AGGIORNATI (${updatedItems.length}):*\n`;
      summaryMessage += updatedItems.map(c =>
        `- ${c.title} (Scade: ${new Date(c.endDate).toLocaleDateString('it-IT')})`
      ).join('\n');
      summaryMessage += `\n\n`;
    }

    if (unchangedItems.length > 0) {
       summaryMessage += `*ℹ️ CONCORSI INVARIATI (${unchangedItems.length})*\n\n`;
    }

    if (createdItems.length === 0 && updatedItems.length === 0 && failedCount === 0) {
        summaryMessage += `ℹ️ Nessun concorso nuovo o aggiornato. Tutto sincronizzato.\n\n`;
    }

    if (failedCount > 0) {
        summaryMessage += `*❌ ATTENZIONE: ${failedCount} (su ${totalChildren}) job falliti.*\n(Controllare i log per i dettagli)\n\n`;
    }

    summaryMessage += `*Totale:* ${createdItems.length} nuovi, ${updatedItems.length} aggiornati, ${unchangedItems.length} invariati, ${failedCount} falliti.`;

    log(summaryMessage);
    await this.notificationService.sendNotification(summaryMessage, heroImageUrl);

    if (isCron) {
        log(`[${strategyId}] ha completato la sua parte di CRON.`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    const logMsg = `❌ ERRORE CRITICO SummaryWorker: Job [${job.id}] fallito: ${err.message}`;
    this.logger.error(logMsg, err.stack);
    this.logService.add(logMsg);
    this.notificationService.sendNotification(logMsg);
  }
}
