import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlConcorsoDto } from 'src/concorsi/dto/crawl-concorso.dto';
import { ICrawlerStrategy, ProcessResult } from './crawler.strategy.interface';
import * as cheerio from 'cheerio';
import {ConcorsiService, CrawlStatus} from 'src/concorsi/concorsi.service';
import { Concorso } from 'src/concorsi/entities/concorso.entity';
import { TargetedNotification } from 'src/notification/notification.types';
import {CheerioAPI} from "cheerio";

// Helper per la data (invariato)
const monthMap: { [key: string]: string } = {
    'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04', 'maggio': '05', 'giugno': '06',
    'luglio': '07', 'agosto': '08', 'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12'
};

const parseDateString: (dateString: string) => (string | null) = (dateString: string): string | null => {
    const parts: string[] = dateString.toLowerCase().split(' ');
    if (parts.length < 3) return null;
    const day: string = parts[0].replace('°', '').padStart(2, '0');
    const month: string = monthMap[parts[1]];
    const year: string = parts[2];
    if (!day || !month || !year) return null;
    return `${year}-${month}-${day}`;
};

@Injectable()
export class DimmiCosaCerchiStrategy implements ICrawlerStrategy {
    private readonly logger: Logger = new Logger(DimmiCosaCerchiStrategy.name);
    private readonly MAX_PAGES_TO_SCRAPE: number = 6;
    private readonly proxyUrl: string;

    // --- OTTIMIZZAZIONE: Nome "amichevole" per i riepiloghi ---
    private readonly friendlyName: string = 'DimmiCosaCerchi';

    // --- OTTIMIZZAZIONE: Selettori Cheerio Centralizzati ---
    private readonly LIST_ITEM_SELECTOR = 'h2.entry-title a.p-url';
    private readonly LIST_NEXT_PAGE_SELECTOR = 'a.next.page-numbers';
    private readonly DETAIL_TITLE_SELECTOR = 'h1.s-title';
    private readonly DETAIL_DESCRIPTION_SELECTOR = '.entry-content p';
    private readonly DETAIL_CONTENT_SELECTOR = '.entry-content';
    private readonly DETAIL_RULES_LINK_SELECTOR = '.entry-content a';
    private readonly DETAIL_IMAGE_SELECTOR_TWITTER = 'meta[name="twitter:image"]';
    private readonly DETAIL_IMAGE_SELECTOR_OG = 'meta[property="og:image"]';
    // --- Fine Selettori ---

    // --- OTTIMIZZAZIONE: Regex delle date centralizzate ---
    private readonly DATE_REGEX_RANGE = /dal (\d+°? \w+ \d{4})\s+al\s+(\d+°? \w+ \d{4})/i;
    private readonly DATE_REGEX_DEADLINE = /(fino al|entro e non oltre il|entro il|scade il)\s+(\d+°? \w+ \d{4})/i;
    // --- Fine Regex ---


    private delay(ms: number): Promise<unknown> {
        return new Promise((resolve: (value: (PromiseLike<unknown>)) => void) => setTimeout(resolve, ms));
    }

    constructor(
        private readonly configService: ConfigService,
        private readonly concorsiService: ConcorsiService,
    ) {
        this.proxyUrl = this.configService.get<string>('MY_PROXY_URL');
        if (this.proxyUrl) {
            this.logger.log(`Strategia configurata per usare il proxy Vercel: ${this.proxyUrl}`);
        } else {
            this.logger.error('!!! MY_PROXY_URL non impostato in .env. Lo scraper fallirà. !!!');
        }
    }

    getStrategyId(): string {
        return 'dimmicosacerchi';
    }

    getBaseUrl(): string {
        return 'https://www.dimmicosacerchi.it/concorsi-a-premi';
    }

    private async fetchHtml(targetUrl: string): Promise<string> {
        if (!this.proxyUrl) {
            throw new Error('Proxy URL non configurato.');
        }
        const randomDelay: number = Math.floor(Math.random() * 2000) + 500;
        await this.delay(randomDelay);
        const fetchUrl = `${this.proxyUrl}?url=${encodeURIComponent(targetUrl)}`;

        this.logger.log(`Fetching ${fetchUrl} (dopo ${randomDelay}ms di attesa)`);

        const response: Response = await fetch(fetchUrl);
        if (!response.ok) {
            const message = `Proxy fetch fallito con stato ${response.status} per ${targetUrl}`;
            this.logger.error(message);
            throw new Error(message);
        }

        try {
            return await response.text();
        } catch (error) {
            this.logger.error(`Errore during la lettura del body: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    async runListing(log: (message: string) => void, baseUrl: string): Promise<string[]> {
        log(`[${this.getStrategyId()}] Avvio scansione elenco: ${baseUrl}`);
        const allDetailLinks = new Set<string>();
        let currentPageUrl: string | null = baseUrl;
        let pageCounter: number = 1;
        try {
            while (currentPageUrl && pageCounter <= this.MAX_PAGES_TO_SCRAPE) {
                log(`[${this.getStrategyId()}] Scansione pagina elenco: ${currentPageUrl} (Pagina ${pageCounter})`);
                const html: string = await this.fetchHtml(currentPageUrl);
                const $: CheerioAPI = cheerio.load(html);
                const linksOnThisPage: string[] = [];

                $(this.LIST_ITEM_SELECTOR).each((i: number, el): void => {
                    const href: string = $(el).attr('href');
                    if (href) linksOnThisPage.push(href);
                });

                if (linksOnThisPage.length === 0) {
                    log(`[${this.getStrategyId()}] Nessun link trovato a pagina ${pageCounter}. Interrompo la paginazione.`);
                    break;
                }
                linksOnThisPage.forEach((link: string) => allDetailLinks.add(link));
                pageCounter++;

                const nextButton = $(this.LIST_NEXT_PAGE_SELECTOR);
                currentPageUrl = nextButton ? nextButton.attr('href') || null : null;
            }
            log(`[${this.getStrategyId()}] Scansione elenco completata. Trovati ${allDetailLinks.size} link unici.`);
            return Array.from(allDetailLinks);
        } catch (error) {
            log(`[${this.getStrategyId()}] ERRORE in runListing: ${error.message}`);
            throw error;
        }
    }

    private _extractDatesFromText(contentText: string): { startDate: Date, endDate: Date } {
        let startDateStr: string | null = null;
        let endDateStr: string | null = null;

        let match: RegExpMatchArray = this.DATE_REGEX_RANGE.exec(contentText);
        if (match?.[1] && match[2]) {
            startDateStr = parseDateString(match[1]);
            endDateStr = parseDateString(match[2]);
        } else {
            match = this.DATE_REGEX_DEADLINE.exec(contentText);
            if (match?.[2]) {
                endDateStr = parseDateString(match[2]);
            }
        }

        const today: string = new Date().toISOString().split('T')[0];
        if (!startDateStr) {
            startDateStr = today;
        }

        if (!endDateStr) {
            const fallbackEndDate = new Date();
            fallbackEndDate.setDate(fallbackEndDate.getDate() + 30); // Default 30 giorni da oggi
            endDateStr = fallbackEndDate.toISOString().split('T')[0];
            this.logger.warn(`Data di fine non trovata. Impostato fallback a 30 giorni: ${endDateStr}`);
        }

        return {
            startDate: new Date(startDateStr),
            endDate: new Date(endDateStr),
        };
    }


    async runDetail(link: string, log: (message: string) => void): Promise<Omit<CrawlConcorsoDto, 'brand'>> {
        const html: string = await this.fetchHtml(link);
        const $: CheerioAPI = cheerio.load(html);

        const title: string = $(this.DETAIL_TITLE_SELECTOR).text().trim() || 'Titolo non trovato';
        const description: string = $(this.DETAIL_DESCRIPTION_SELECTOR).first().text().trim() || '';

        let rulesUrl: string | undefined = null;
        $(this.DETAIL_RULES_LINK_SELECTOR).each((i: number, el): boolean => {
            if ($(el).text().toLowerCase().includes('regolamento')) {
                rulesUrl = $(el).attr('href');
                return false; // Interrompe il loop .each
            }
        });

        const contentText: string = $(this.DETAIL_CONTENT_SELECTOR).text() || '';

        const images: string[] = [];
        const imageUrl: string = $(this.DETAIL_IMAGE_SELECTOR_TWITTER).attr('content') || $(this.DETAIL_IMAGE_SELECTOR_OG).attr('content');

        if (imageUrl) {
            const absoluteUrl: string = new URL(imageUrl, new URL(link).origin).href;
            images.push(absoluteUrl);
        }

        const { startDate, endDate } = this._extractDatesFromText(contentText);

        return {
            title: title,
            description: description,
            rulesUrl: rulesUrl || link, // Fallback a link se non trovato
            source: link,
            sourceId: new URL(link).pathname,
            startDate: startDate,
            endDate: endDate,
            images: images,
        };
    }

    async processDetail(
        detailData: Omit<CrawlConcorsoDto, 'brand'>,
    ): Promise<ProcessResult> {
        const dto: CrawlConcorsoDto = {
            ...detailData,
            brand: this.getStrategyId(),
        };
        const result: { concorso: Concorso; status: CrawlStatus } = await this.concorsiService.createOrUpdateFromCrawl(dto);
        return {
            status: result.status,
            entity: result.concorso,
        };
    }

    public formatSummary(
        results: ProcessResult[],
        totalChildren: number,
        failedCount: number,
        strategyId: string,
    ): TargetedNotification {
        const grouped: Record<string, Concorso[]> = {
            created: [],
            updated: [],
            unchanged: [],
        };

        // Raggruppa i concorsi per stato
        for (const result of results) {
            const concorso = result.entity as Concorso;
            grouped[result.status]?.push(concorso);
        }

        const heroImageUrl =
            grouped.created[0]?.images?.[0] ??
            grouped.updated[0]?.images?.[0];

        // Funzione helper per generare le sezioni
        const buildSection = (items: Concorso[], emoji: string, title: string) =>
            items.length === 0
                ? ''
                : `*${emoji} ${title} ${items.length}:*\n` +
                items
                    .map(c => {
                        const shortDesc = c.description.substring(0, 80).trimEnd() + '...';
                        return `*${c.title}*\n_${shortDesc}_\n[Vai ai Dettagli](${c.source}) | [Leggi il Regolamento](${c.rulesUrl})`;
                    })
                    .join('\n\n') + '\n\n';

        // Costruisci il messaggio
        let summaryMessage = `*Novità Concorsi da ${this.friendlyName}*\n\n`;
        summaryMessage += buildSection(grouped.created, '✅', 'Ecco i nuovi concorsi');
        summaryMessage += buildSection(grouped.updated, '🔄', 'concorsi aggiornati');

        if (grouped.unchanged.length > 0) {
            summaryMessage += `*ℹ️ ${grouped.unchanged.length} concorsi controllati (nessuna modifica).*\n\n`;
        }

        if (!grouped.created.length && !grouped.updated.length && failedCount === 0) {
            summaryMessage += `✅ Nessuna novità per ora. Tutti i concorsi sono già sincronizzati!\n\n`;
        }

        if (failedCount > 0) {
            summaryMessage += `*❌ ATTENZIONE: ${failedCount} (su ${totalChildren}) elementi non sono stati processati.*\n(Controllare i log per i dettagli).\n\n`;
        }

        summaryMessage += `*Riepilogo finale:* ${grouped.created.length} nuovi, ${grouped.updated.length} aggiornati, ${grouped.unchanged.length} invariati, ${failedCount} falliti.`;

        // Determina i canali target
        const channelsKey = `${strategyId.toUpperCase()}_NOTIFY_CHANNELS`;
        const channelsConfig = this.configService.get<string>(channelsKey);
        const targetChannels = channelsConfig
            ? channelsConfig.split(',').map(c => c.trim()).filter(Boolean)
            : null;

        this.logger.log(
            `[${strategyId}] Riepilogo per ${targetChannels?.length ? 'canali specifici: ' + targetChannels.join(',') : 'TUTTI i canali'}.`
        );

        return {
            payload: { message: summaryMessage, imageUrl: heroImageUrl },
            channels: targetChannels,
        };
    }

}