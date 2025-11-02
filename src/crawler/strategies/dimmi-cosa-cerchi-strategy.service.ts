import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Importato
import { CrawlConcorsoDto } from 'src/concorsi/dto/crawl-concorso.dto';
import { ICrawlerStrategy } from './crawler.strategy.interface';
import * as cheerio from 'cheerio';

// --- FUNZIONI HELPER PER IL PARSING ---
const monthMap: { [key: string]: string } = {
  'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04', 'maggio': '05', 'giugno': '06',
  'luglio': '07', 'agosto': '08', 'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12'
};

const parseDateString = (dateString: string): string | null => {
  try {
    const parts = dateString.toLowerCase().split(' ');
    if (parts.length < 3) return null;
    const day = parts[0].replace('°', '').padStart(2, '0');
    const month = monthMap[parts[1]];
    const year = parts[2];
    if (!day || !month || !year) return null;
    return `${year}-${month}-${day}`;
  } catch (e) { return null; }
};
// --- FINE FUNZIONI HELPER ---

@Injectable()
export class DimmiCosaCerchiStrategy implements ICrawlerStrategy {
  private readonly logger = new Logger(DimmiCosaCerchiStrategy.name);

  // Rispettiamo robots.txt (visto in chat precedente)
  private readonly MAX_PAGES_TO_SCRAPE = 6;

  // --- LOGICA PROXY VERCEL ---
  private readonly proxyUrl: string;

  // --- MODIFICA INIZIO ---
  /**
   * Helper per creare una pausa (usato per il Jitter)
   */
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  // --- MODIFICA FINE ---

  constructor(private readonly configService: ConfigService) {
    this.proxyUrl = this.configService.get<string>('MY_PROXY_URL');
    if (!this.proxyUrl) {
      this.logger.error('!!! MY_PROXY_URL non impostato in .env. Lo scraper fallirà. !!!');
    } else {
      this.logger.log(`Strategia configurata per usare il proxy Vercel: ${this.proxyUrl}`);
    }
  }
  // --- FINE LOGICA PROXY ---

  getStrategyId(): string {
    return 'dimmicosacerchi';
  }

  getBaseUrl(): string {
    return 'https://www.dimmicosacerchi.it/concorsi-a-premi';
  }

  /**
   * Helper per fetchare (MODIFICATO per usare il proxy Vercel E JITTER)
   */
  private async fetchHtml(targetUrl: string): Promise<string> {
    if (!this.proxyUrl) {
      throw new Error('Proxy URL non configurato.');
    }

    // --- MODIFICA INIZIO ---
    // Aggiungiamo un "jitter" (pausa casuale) tra 500ms e 2500ms
    // per rendere le richieste meno ritmiche.
    const randomDelay = Math.floor(Math.random() * 2000) + 500;
    await this.delay(randomDelay);
    // --- MODIFICA FINE ---

    // Costruiamo l'URL del proxy passando l'URL target come parametro
    const fetchUrl = `${this.proxyUrl}?url=${encodeURIComponent(targetUrl)}`;

    // --- MODIFICA INIZIO (log aggiornato) ---
    console.log(`Fetching ${fetchUrl} (dopo ${randomDelay}ms di attesa)`);
    // --- MODIFICA FINE ---

    try {
      // Chiamiamo il nostro proxy Vercel
      const response = await fetch(fetchUrl);

      if (!response.ok) {
        throw new Error(`Proxy fetch fallito con stato ${response.status} per ${targetUrl}`);
      }
      return await response.text();

    } catch (error) {
      this.logger.error(`Errore durante il fetch via proxy Vercel: ${error.message}`);
      throw error;
    }
  }


  /**
   * FASE 1: Scansione Elenco e Paginazione (Usa fetchHtml)
   */
  async runListing(log: (message: string) => void, baseUrl: string): Promise<string[]> {
    log(`[${this.getStrategyId()}] Avvio scansione elenco: ${baseUrl}`);

    const allDetailLinks = new Set<string>();
    let currentPageUrl: string | null = baseUrl;
    let pageCounter = 1;

    try {
      while (currentPageUrl && pageCounter <= this.MAX_PAGES_TO_SCRAPE) {
        log(`[${this.getStrategyId()}] Scansione pagina elenco: ${currentPageUrl} (Pagina ${pageCounter})`);

        // --- USA L'HELPER PROXY ---
        const html = await this.fetchHtml(currentPageUrl);
        // --- FINE MODIFICA ---

        const $ = cheerio.load(html);

        const linksOnThisPage: string[] = [];
        $('h2.entry-title a.p-url').each((i, el) => {
          const href = $(el).attr('href');
          if (href) linksOnThisPage.push(href);
        });

        if (linksOnThisPage.length === 0) {
          log(`[${this.getStrategyId()}] Nessun link trovato a pagina ${pageCounter}. Interrompo la paginazione.`);
          break;
        }

        linksOnThisPage.forEach(link => allDetailLinks.add(link));
        pageCounter++;

        // La paginazione è disabilitata (MAX_PAGES_TO_SCRAPE = 1), ma lasciamo la logica
        const nextButton = $('a.next.page-numbers');
        currentPageUrl = nextButton ? nextButton.attr('href') || null : null;
      }

      log(`[${this.getStrategyId()}] Scansione elenco completata. Trovati ${allDetailLinks.size} link unici.`);
      return Array.from(allDetailLinks);

    } catch (error) {
      log(`[${this.getStrategyId()}] ERRORE in runListing: ${error.message}`);
      throw error;
    }
  }

  /**
   * FASE 2: Scraping Pagina di Dettaglio (Usa fetchHtml)
   */
  async runDetail(link: string, log: (message: string) => void): Promise<Omit<CrawlConcorsoDto, 'brand'>> {

    // --- USA L'HELPER PROXY ---
    const html = await this.fetchHtml(link);
    // --- FINE MODIFICA ---

    const $ = cheerio.load(html);

    // Selettori basati su 'sotto index.html'
    const title = $('h1.s-title').text().trim() || 'Titolo non trovato';
    const description = $('.entry-content p').first().text().trim() || '';

    let rulesUrl = null;
    $('.entry-content a').each((i, el) => {
      if ($(el).text().toLowerCase().includes('regolamento')) {
        rulesUrl = $(el).attr('href');
        return false;
      }
    });

    const contentText = $('.entry-content').text() || '';

    // --- Estrazione Immagine ---
    const images: string[] = [];
    const imageUrl = $('meta[name="twitter:image"]').attr('content') || $('meta[property="og:image"]').attr('content');

    if (imageUrl) {
      try {
        const absoluteUrl = new URL(imageUrl, new URL(link).origin).href;
        images.push(absoluteUrl);
      } catch (e) {
        log(`[${this.getStrategyId()}] URL immagine non valido: ${imageUrl}`);
      }
    }
    // --- Fine Estrazione Immagine ---

    // Parsing date (da 'sotto index.html')
    let startDateStr: string | null = null;
    let endDateStr: string | null = null;

    let match = contentText.match(/dal (\d+°? \w+ \d{4})\s+al\s+(\d+°? \w+ \d{4})/i);
    if (match && match[1] && match[2]) {
      startDateStr = parseDateString(match[1]);
      endDateStr = parseDateString(match[2]);
    } else {
      match = contentText.match(/(fino al|entro e non oltre il|entro il|scade il)\s+(\d+°? \w+ \d{4})/i);
      if (match && match[2]) {
        endDateStr = parseDateString(match[2]);
      }
    }

    const today = new Date().toISOString().split('T')[0];
    if (!startDateStr) startDateStr = today;
    if (!endDateStr) {
      const fallbackEndDate = new Date();
      fallbackEndDate.setDate(fallbackEndDate.getDate() + 30);
      endDateStr = fallbackEndDate.toISOString().split('T')[0];
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    return {
      title: title,
      description: description,
      rulesUrl: rulesUrl || link,
      source: link,
      sourceId: new URL(link).pathname,
      startDate: startDate,
      endDate: endDate,
      images: images,
    };
  }
}