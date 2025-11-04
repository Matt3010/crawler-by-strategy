import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlConcorsoDto } from 'src/concorsi/dto/crawl-concorso.dto';
import { ICrawlerStrategy, ProcessResult } from './crawler.strategy.interface';
import * as cheerio from 'cheerio';
import {ConcorsiService, CrawlStatus} from 'src/concorsi/concorsi.service';
import { Concorso } from 'src/concorsi/entities/concorso.entity';
import { TargetedNotification } from 'src/notification/notification.types';
import {CheerioAPI} from "cheerio";

const monthMap: { [key: string]: string } = {
    'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04', 'maggio': '05', 'giugno': '06',
    'luglio': '07', 'agosto': '08', 'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12'
};

const parseDateString: (dateString: string) => (string | null) = (dateString: string): string | null => {
    try {
        const parts: string[] = dateString.toLowerCase().split(' ');
        if (parts.length < 3) return null;
        const day: string = parts[0].replace('°', '').padStart(2, '0');
        const month: string = monthMap[parts[1]];
        const year: string = parts[2];
        if (!day || !month || !year) return null;
        return `${year}-${month}-${day}`;
    } catch (e) { return null; }
};

@Injectable()
export class DimmiCosaCerchiStrategy implements ICrawlerStrategy {
    private readonly logger: Logger = new Logger(DimmiCosaCerchiStrategy.name);
    private readonly MAX_PAGES_TO_SCRAPE: number = 6;
    private readonly proxyUrl: string;

    private delay(ms: number): Promise<unknown> {
        return new Promise((resolve: (value: (PromiseLike<unknown> | unknown)) => void) => setTimeout(resolve, ms));
    }

    constructor(
        private readonly configService: ConfigService,
        private readonly concorsiService: ConcorsiService,
    ) {
        this.proxyUrl = this.configService.get<string>('MY_PROXY_URL');
        if (!this.proxyUrl) {
            this.logger.error('!!! MY_PROXY_URL non impostato in .env. Lo scraper fallirà. !!!');
        } else {
            this.logger.log(`Strategia configurata per usare il proxy Vercel: ${this.proxyUrl}`);
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
        console.log(`Fetching ${fetchUrl} (dopo ${randomDelay}ms di attesa)`);
        const response: Response = await fetch(fetchUrl);
        if (!response.ok) {
            const message = `Proxy fetch fallito con stato ${response.status} per ${targetUrl}`;
            this.logger.error(message);
            throw new Error(message);
        }

        try {
            return await response.text();
        } catch (error) {
            this.logger.error(`Errore durante la lettura del body: ${error instanceof Error ? error.message : String(error)}`);
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
                $('h2.entry-title a.p-url').each((i: number, el): void => {
                    const href: string = $(el).attr('href');
                    if (href) linksOnThisPage.push(href);
                });
                if (linksOnThisPage.length === 0) {
                    log(`[${this.getStrategyId()}] Nessun link trovato a pagina ${pageCounter}. Interrompo la paginazione.`);
                    break;
                }
                linksOnThisPage.forEach(link => allDetailLinks.add(link));
                pageCounter++;
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

    async runDetail(link: string, log: (message: string) => void): Promise<Omit<CrawlConcorsoDto, 'brand'>> {
        const html: string = await this.fetchHtml(link);
        const $: CheerioAPI = cheerio.load(html);
        const title: string = $('h1.s-title').text().trim() || 'Titolo non trovato';
        const description: string = $('.entry-content p').first().text().trim() || '';
        let rulesUrl: string | undefined = null;
        $('.entry-content a').each((i: number, el): boolean => {
            if ($(el).text().toLowerCase().includes('regolamento')) {
                rulesUrl = $(el).attr('href');
                return false;
            }
        });
        const contentText: string = $('.entry-content').text() || '';
        const images: string[] = [];
        const imageUrl: string = $('meta[name="twitter:image"]').attr('content') || $('meta[property="og:image"]').attr('content');
        if (imageUrl) {
            try {
                const absoluteUrl: string = new URL(imageUrl, new URL(link).origin).href;
                images.push(absoluteUrl);
            } catch (e) {
                log(`[${this.getStrategyId()}] URL immagine non valido: ${imageUrl}`);
            }
        }
        let startDateStr: string | null = null;
        let endDateStr: string | null = null;
        let match: RegExpMatchArray = contentText.match(/dal (\d+°? \w+ \d{4})\s+al\s+(\d+°? \w+ \d{4})/i);
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

    formatSummary(
        results: ProcessResult[],
        totalChildren: number,
        failedCount: number,
        strategyId: string,
    ): TargetedNotification {
        const createdItems: Concorso[] = [];
        const updatedItems: Concorso[] = [];
        const unchangedItems: Concorso[] = [];

        for (const result of results) {
            const concorso = result.entity as Concorso;
            if (result.status === 'created') {
                createdItems.push(concorso);
            } else if (result.status === 'updated') {
                updatedItems.push(concorso);
            } else if (result.status === 'unchanged') {
                unchangedItems.push(concorso);
            }
        }

        let heroImageUrl: string | undefined = undefined;
        if (createdItems.length > 0 && createdItems[0].images?.length > 0) {
            heroImageUrl = createdItems[0].images[0];
        } else if (updatedItems.length > 0 && updatedItems[0].images?.length > 0) {
            heroImageUrl = updatedItems[0].images[0];
        }

        let summaryMessage = `*Riepilogo Scansione [${strategyId}]*\n\n`;
        if (createdItems.length > 0) {
            summaryMessage += `*✅ NUOVI CONCORSI (${createdItems.length}):*\n`;
            summaryMessage += createdItems.map((c: Concorso) => {
                    const shortDesc: string = c.description.substring(0, 80).replace(/\s+$/, '') + '...';
                    return `*${c.title}* (${c.brand})\n` +
                        `_${shortDesc}_\n` +
                        `[Regolamento](${c.rulesUrl}) | [Fonte](${c.source})`;
                }
            ).join('\n\n');
            summaryMessage += `\n\n`;
        }

        if (updatedItems.length > 0) {
            summaryMessage += `*🔄 CONCORSI AGGIORNATI (${updatedItems.length}):*\n`;
            summaryMessage += updatedItems.map((c: Concorso) => {
                    const shortDesc: string = c.description.substring(0, 80).replace(/\s+$/, '') + '...';
                    return `*${c.title}* (${c.brand})\n` +
                        `_${shortDesc}_\n` +
                        `[Regolamento](${c.rulesUrl}) | [Fonte](${c.source})`;
                }
            ).join('\n\n');
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

        const channelsKey = `${strategyId.toUpperCase()}_NOTIFY_CHANNELS`;
        const channelsConfig: string = this.configService.get<string>(channelsKey);

        let targetChannels: string[] | null = null;
        if (channelsConfig) {
            targetChannels = channelsConfig.split(',').map((c: string) => c.trim()).filter(Boolean);
            this.logger.log(`[${strategyId}] Riepilogo per canali specifici: ${targetChannels.join(',')}`);
        } else {
            this.logger.log(`[${strategyId}] Riepilogo per TUTTI i canali (nessun target specifico).`);
        }

        return {
            payload: {
                message: summaryMessage,
                imageUrl: heroImageUrl,
            },
            channels: targetChannels,
        };
    }
}