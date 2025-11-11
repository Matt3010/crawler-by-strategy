import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlConcorsoDto } from 'src/concorsi/dto/crawl-concorso.dto';
import { ICrawlerStrategy, ProcessResult } from '../crawler.strategy.interface';
import * as cheerio from 'cheerio';
import { ConcorsiService, CrawlStatus } from 'src/concorsi/concorsi.service';
import { Concorso } from 'src/concorsi/entities/concorso.entity';
import { TargetedNotification } from 'src/notification/notification.types';
import { CheerioAPI } from "cheerio";

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

export abstract class BaseDimmiCosaCerchiStrategy implements ICrawlerStrategy {
    protected readonly logger: Logger;
    protected readonly proxyUrl: string;

    // Proprietà astratte che le classi figlie DEVONO definire
    abstract readonly friendlyName: string;
    abstract readonly MAX_PAGES_TO_SCRAPE: number;
    abstract readonly LIST_ITEM_SELECTOR: string;
    abstract readonly LIST_NEXT_PAGE_SELECTOR: string;
    abstract readonly DETAIL_TITLE_SELECTOR: string;
    abstract readonly DETAIL_DESCRIPTION_SELECTOR: string;
    abstract readonly DETAIL_CONTENT_SELECTOR: string;
    abstract readonly DETAIL_RULES_LINK_SELECTOR: string;
    abstract readonly DETAIL_IMAGE_SELECTOR_TWITTER: string;
    abstract readonly DETAIL_IMAGE_SELECTOR_OG: string;

    // Metodi astratti dall'interfaccia
    abstract getStrategyId(): string;
    abstract getBaseUrl(): string;

    // Proprietà comuni
    private readonly DATE_REGEX_RANGE: RegExp = /dal (\d+°? \w+ \d{4})\s+al\s+(\d+°? \w+ \d{4})/i;
    private readonly DATE_REGEX_DEADLINE: RegExp = /(fino al|entro e non oltre il|entro il|scade il)\s+(\d+°? \w+ \d{4})/i;

    private delay(ms: number): Promise<void> {
        return new Promise((resolve: (value: (PromiseLike<void> | void)) => void) => setTimeout(resolve, ms));
    }

    constructor(
        protected readonly configService: ConfigService,
        protected readonly concorsiService: ConcorsiService,
    ) {
        // Imposta il logger con il nome della classe concreta (figlia)
        this.logger = new Logger(this.constructor.name);

        this.proxyUrl = this.configService.get<string>('MY_PROXY_URL');
        if (!this.proxyUrl) {
            this.logger.error('!!! MY_PROXY_URL not set in .env. The scraper will fail. !!!');
        }
    }

    // --- Logica Condivisa ---

    protected async fetchHtml(targetUrl: string): Promise<string> {
        if (!this.proxyUrl) throw new Error('Proxy URL not configured.');

        const randomDelay: number = Math.floor(Math.random() * 2000) + 500;
        await this.delay(randomDelay);
        const fetchUrl: string = `${this.proxyUrl}?url=${encodeURIComponent(targetUrl)}`;

        this.logger.log(`Fetching ${fetchUrl} (after ${randomDelay}ms delay)`);

        const response: Response = await fetch(fetchUrl);
        if (!response.ok) {
            const message: string = `Proxy fetch failed with status ${response.status} for ${targetUrl}`;
            this.logger.error(message);
            throw new Error(message);
        }

        try {
            return await response.text();
        } catch (error) {
            this.logger.error(`Error reading body: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    public async runListing(log: (message: string) => void, baseUrl: string): Promise<string[]> {
        log(`[${this.getStrategyId()}] Starting list scan: ${baseUrl}`);
        const allDetailLinks: Set<string> = new Set<string>();
        let currentPageUrl: string | null = baseUrl;
        let pageCounter: number = 1;

        try {
            while (currentPageUrl && pageCounter <= this.MAX_PAGES_TO_SCRAPE) {
                log(`[${this.getStrategyId()}] Scanning list page: ${currentPageUrl} (Page ${pageCounter})`);
                const html: string = await this.fetchHtml(currentPageUrl);
                const $: CheerioAPI = cheerio.load(html);
                const linksOnThisPage: string[] = [];

                $(this.LIST_ITEM_SELECTOR).each((_: number, el): void => {
                    const href: string | undefined = $(el).attr('href');
                    if (href) linksOnThisPage.push(href);
                });

                if (linksOnThisPage.length === 0) {
                    log(`[${this.getStrategyId()}] No links found on page ${pageCounter}. Stopping pagination.`);
                    break;
                }

                linksOnThisPage.forEach((link: string): Set<string> => allDetailLinks.add(link));
                pageCounter++;

                const nextButton = $(this.LIST_NEXT_PAGE_SELECTOR);
                currentPageUrl = nextButton ? nextButton.attr('href') || null : null;
            }

            log(`[${this.getStrategyId()}] List scan complete. Found ${allDetailLinks.size} unique links.`);
            return Array.from(allDetailLinks);
        } catch (error) {
            log(`[${this.getStrategyId()}] ERROR in runListing: ${error.message}`);
            throw error;
        }
    }

    protected _extractDatesFromText(contentText: string): { startDate: Date, endDate: Date } {
        let startDateStr: string | null = null;
        let endDateStr: string | null = null;

        let match: RegExpExecArray | null = this.DATE_REGEX_RANGE.exec(contentText);
        if (match?.[1] && match[2]) {
            startDateStr = parseDateString(match[1]);
            endDateStr = parseDateString(match[2]);
        } else {
            match = this.DATE_REGEX_DEADLINE.exec(contentText);
            if (match?.[2]) endDateStr = parseDateString(match[2]);
        }

        const today: string = new Date().toISOString().split('T')[0];
        if (!startDateStr) startDateStr = today;

        if (!endDateStr) {
            const fallbackEndDate: Date = new Date();
            fallbackEndDate.setDate(fallbackEndDate.getDate() + 30);
            endDateStr = fallbackEndDate.toISOString().split('T')[0];
            this.logger.warn(`End date not found. Fallback set to +30 days: ${endDateStr}`);
        }

        return {
            startDate: new Date(startDateStr),
            endDate: new Date(endDateStr),
        };
    }

    public async runDetail(link: string, log: (message: string) => void): Promise<Omit<CrawlConcorsoDto, 'brand'>> {
        const html: string = await this.fetchHtml(link);
        const $: CheerioAPI = cheerio.load(html);

        const title: string = $(this.DETAIL_TITLE_SELECTOR).text().trim() || 'Title not found';
        const description: string = $(this.DETAIL_DESCRIPTION_SELECTOR).first().text().trim() || '';

        let rulesUrl: string | undefined = undefined;
        $(this.DETAIL_RULES_LINK_SELECTOR).each((_: number, el): (false | void) => {
            if ($(el).text().toLowerCase().includes('regolamento')) {
                rulesUrl = $(el).attr('href');
                return false;
            }
        });

        const contentText: string = $(this.DETAIL_CONTENT_SELECTOR).text() || '';

        const images: string[] = [];
        const imageUrl: string | undefined =
            $(this.DETAIL_IMAGE_SELECTOR_TWITTER).attr('content') ||
            $(this.DETAIL_IMAGE_SELECTOR_OG).attr('content');

        if (imageUrl) {
            const absoluteUrl: string = new URL(imageUrl, new URL(link).origin).href;
            images.push(absoluteUrl);
        }

        const { startDate, endDate } = this._extractDatesFromText(contentText);

        return {
            title,
            description,
            rulesUrl: rulesUrl || link,
            source: link,
            sourceId: new URL(link).pathname,
            startDate,
            endDate,
            images,
        };
    }

    protected _formatIndividualNotification(concorso: Concorso, status: CrawlStatus): TargetedNotification {
        const isNew: boolean = status === 'created';
        const emoji: string = isNew ? '✅' : '🔄';
        const titlePrefix: string = isNew ? 'Nuovo Concorso' : 'Concorso Aggiornato';

        const endDate: string = new Date(concorso.endDate).toLocaleDateString('it-IT', {
            day: '2-digit', 'month': 'long', 'year': 'numeric'
        });
        const shortDesc: string = concorso.description.substring(0, 150).trimEnd() + '...';

        const message: string = `*${emoji} ${titlePrefix}: ${concorso.title}*\n\n` +
            `_${shortDesc}_\n\n` +
            `🗓️ *Scadenza:* ${endDate}\n\n` +
            `[Vedi Dettagli](${concorso.source})\n` +
            `[Leggi Regolamento](${concorso.rulesUrl})`;

        const imageUrl: string | null = concorso.images?.[0] || null;

        const channelsKey: string = `${this.getStrategyId().toUpperCase()}_NOTIFY_CHANNELS`;
        const channelsConfig: string | undefined = this.configService.get<string>(channelsKey);
        const targetChannels: string[] | null = channelsConfig ? channelsConfig.split(',').map((c: string): string => c.trim()).filter(Boolean) : null;

        return {
            payload: {
                message,
                imageUrl,
                disableNotification: true
            },
            channels: targetChannels
        };
    }

    public async processDetail(detailData: Omit<CrawlConcorsoDto, 'brand'>, log?: (message: string) => void): Promise<ProcessResult> {
        const dto: CrawlConcorsoDto = { ...detailData, brand: this.getStrategyId() };
        const result: { concorso: Concorso; status: CrawlStatus } = await this.concorsiService.createOrUpdateFromCrawl(dto);

        let notification: TargetedNotification | null = null;

        if (result.status === 'created' || result.status === 'updated') {
            try {
                notification = this._formatIndividualNotification(result.concorso, result.status);
            } catch (e) {
                (log || this.logger.log).call(this.logger, `Failed to format individual notification for ${result.concorso.title}: ${e.message}`);
            }
        }

        return {
            status: result.status,
            entity: result.concorso,
            individualNotification: notification
        };
    }

    public formatSummary(
        results: ProcessResult[],
        totalChildren: number,
        failedCount: number,
        strategyId: string,
    ): TargetedNotification {

        const createdCount: number = results.filter((r: ProcessResult): boolean => r.status === 'created').length;
        const updatedCount: number = results.filter((r: ProcessResult): boolean => r.status === 'updated').length;
        const unchangedCount: number = results.filter((r: ProcessResult): boolean => r.status === 'unchanged').length;

        const shouldNotify: boolean = createdCount > 0 || updatedCount > 0 || failedCount > 0;

        if (!shouldNotify && unchangedCount > 0) {
            this.logger.log(`[${strategyId}] Summary suppressed: No new/updated/failed items.`);
            return null;
        }

        const summaryMessage: string = `*📊 Scan Summary: ${this.friendlyName}*\n\n` +
            `✅ *New:* ${createdCount}\n` +
            `🔄 *Updated:* ${updatedCount}\n` +
            `ℹ️ *Unchanged:* ${unchangedCount}\n` +
            `❌ *Failed:* ${failedCount}\n\n` +
            `*Total processed:* ${totalChildren}`;

        const channelsKey: string = `${strategyId.toUpperCase()}_NOTIFY_CHANNELS`;
        const channelsConfig: string | undefined = this.configService.get<string>(channelsKey);
        const targetChannels: string[] | null = channelsConfig
            ? channelsConfig.split(',').map((c: string): string => c.trim()).filter(Boolean)
            : null;

        this.logger.log(
            `[${strategyId}] Summary STATS for ${targetChannels?.length ? 'specific channels: ' + targetChannels.join(',') : 'ALL channels'}.`
        );

        return {
            payload: {
                message: summaryMessage,
                imageUrl: null,
                disableNotification: !shouldNotify
            },
            channels: targetChannels,
        };
    }
}