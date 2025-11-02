import { CrawlConcorsoDto } from 'src/concorsi/dto/crawl-concorso.dto';

/**
 * Definisce il contratto per una strategia di crawling.
 */
export interface ICrawlerStrategy {
  /**
   * Identificatore univoco per questa strategia.
   */
  getStrategyId(): string;

  /**
   * URL di base del sito, usato dal gestore per sapere cosa passare.
   */
  getBaseUrl(): string;

  /**
   * Esegue la scansione della pagina elenco e della paginazione.
   * Ritorna un elenco di URL di dettaglio da analizzare.
   */
  runListing(logger: (message: string) => void, baseUrl: string): Promise<string[]>;

  /**
   * Esegue lo scraping di una singola pagina di dettaglio.
   * Omettiamo 'brand' perché viene derivato nel worker.
   */
  runDetail(link: string, logger: (message: string) => void): Promise<Omit<CrawlConcorsoDto, 'brand'>>;
}
