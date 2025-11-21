import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlConcorsoDto } from 'src/activities/concorsi/dto/crawl-concorso.dto';
import { ICrawlerStrategy, ProcessResult } from '../../../../crawler/strategies/crawler.strategy.interface';
import * as cheerio from 'cheerio';
import { ConcorsiService } from 'src/activities/concorsi/concorsi.service';
import { Concorso } from 'src/activities/concorsi/entities/concorso.entity';
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

export abstract class BaseDimmiCosaCerchiStrategy implements ICrawlerStrategy<Concorso, Omit<CrawlConcorsoDto, 'brand'>> {
    protected readonly logger: Logger;
    protected readonly proxyUrl: string;

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

    abstract getStrategyId(): string;
    abstract getBaseUrl(): string;

    private readonly DATE_REGEX_RANGE: RegExp = /dal (\d+°? \w+ \d{4})\s+al\s+(\d+°? \w+ \d{4})/i;
    private readonly DATE_REGEX_DEADLINE: RegExp = /(fino al|entro e non oltre il|entro il|scade il)\s+(\d+°? \w+ \d{4})/i;

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    constructor(
        protected readonly configService: ConfigService,
        protected readonly concorsiService: ConcorsiService,
    ) {
        this.logger = new Logger(this.constructor.name);
        this.proxyUrl = this.configService.get<string>('MY_PROXY_URL');
        if (!this.proxyUrl) {
            this.logger.error('!!! MY_PROXY_URL not set in .env. The scraper will fail. !!!');
        }
    }

    protected async fetchHtml(targetUrl: string): Promise<string> {
        if (!this.proxyUrl) throw new Error('Proxy URL not configured.');

        const randomDelay: number = Math.floor(Math.random() * 2000) + 500;
        await this.delay(randomDelay);
        const fetchUrl: string = `${this.proxyUrl}?url=${encodeURIComponent(targetUrl)}`;

        this.logger.log(`Fetching ${fetchUrl} (after ${randomDelay}ms delay)`);

        const response: Response = await fetch(fetchUrl);
        if (!response.ok) {
            throw new Error(`Proxy fetch failed with status ${response.status} for ${targetUrl}`);
        }
        return await response.text();
    }

    public async runListing(log: (message: string) => void, baseUrl: string): Promise<string[]> {
        log(`[${this.getStrategyId()}] Starting list scan: ${baseUrl}`);
        const allDetailLinks: Set<string> = new Set<string>();
        let currentPageUrl: string | null = baseUrl;
        let pageCounter: number = 1;

        try {
            while (currentPageUrl && pageCounter <= this.MAX_PAGES_TO_SCRAPE) {
                const html: string = await this.fetchHtml(currentPageUrl);
                const $: CheerioAPI = cheerio.load(html);
                const linksOnThisPage: string[] = [];

                $(this.LIST_ITEM_SELECTOR).each((_, el) => {
                    const href = $(el).attr('href');
                    if (href) linksOnThisPage.push(href);
                });

                if (linksOnThisPage.length === 0) break;

                linksOnThisPage.forEach((link) => allDetailLinks.add(link));
                pageCounter++;

                const nextButton = $(this.LIST_NEXT_PAGE_SELECTOR);
                currentPageUrl = nextButton ? nextButton.attr('href') || null : null;
            }
            return Array.from(allDetailLinks);
        } catch (error) {
            log(`[${this.getStrategyId()}] ERROR in runListing: ${error.message}`);
            throw error;
        }
    }

    protected _extractDatesFromText(contentText: string): { startDate: Date } {
        let startDateStr: string | null = null;

        let match = this.DATE_REGEX_RANGE.exec(contentText);
        if (match?.[1] && match[2]) {
            startDateStr = parseDateString(match[1]);
        } else {
            match = this.DATE_REGEX_DEADLINE.exec(contentText);
            if (match?.[2]) {
                startDateStr = parseDateString(match[2]);
            }
        }

        const today = new Date().toISOString().split('T')[0];
        if (!startDateStr) startDateStr = today;

        return {
            startDate: new Date(startDateStr),
        };
    }

    public async runDetail(link: string, log: (message: string) => void): Promise<Omit<CrawlConcorsoDto, 'brand'>> {
        const html: string = await this.fetchHtml(link);
        const $: CheerioAPI = cheerio.load(html);

        const title: string = $(this.DETAIL_TITLE_SELECTOR).text().trim() || 'Title not found';
        const description: string = $(this.DETAIL_DESCRIPTION_SELECTOR).first().text().trim() || '';

        let rulesUrl: string | undefined = undefined;
        $(this.DETAIL_RULES_LINK_SELECTOR).each((_, el) => {
            if ($(el).text().toLowerCase().includes('regolamento')) {
                rulesUrl = $(el).attr('href');
                return false;
            }
        });

        const contentText: string = $(this.DETAIL_CONTENT_SELECTOR).text() || '';

        const images: string[] = [];
        const imageUrl = $(this.DETAIL_IMAGE_SELECTOR_TWITTER).attr('content') ||
            $(this.DETAIL_IMAGE_SELECTOR_OG).attr('content');

        if (imageUrl) {
            const absoluteUrl = new URL(imageUrl, new URL(link).origin).href;
            images.push(absoluteUrl);
        }

        const { startDate } = this._extractDatesFromText(contentText);

        return {
            title,
            description,
            rulesUrl: rulesUrl || link,
            source: link,
            sourceId: new URL(link).pathname,
            startDate,
            images,
        };
    }

    public async processDetail(detailData: Omit<CrawlConcorsoDto, 'brand'>, log?: (message: string) => void): Promise<ProcessResult<Concorso>> {
        const dto: CrawlConcorsoDto = { ...detailData, brand: this.getStrategyId() };
        const result = await this.concorsiService.createOrUpdateFromCrawl(dto);

        let notification: TargetedNotification | null = null;
        if (result.status === 'created' || result.status === 'updated') {
            try {
                notification = this._formatIndividualNotification(result.concorso, result.status);
            } catch (e) {
                (log || this.logger.log).call(this.logger, `Failed to format notification: ${e.message}`);
            }
        }

        return {
            status: result.status,
            entity: result.concorso,
            individualNotification: notification
        };
    }

    protected _formatIndividualNotification(concorso: Concorso, status: string): TargetedNotification {
        const isNew = status === 'created';
        const emoji = isNew ? '✅' : '🔄';
        const titlePrefix = isNew ? 'Nuovo Concorso' : 'Concorso Aggiornato';

        const startDate = new Date(concorso.startDate).toLocaleDateString('it-IT', { day: '2-digit', 'month': 'long', 'year': 'numeric' });

        const shortDesc = concorso.description.substring(0, 150).trimEnd() + '...';

        const message = `*${emoji} ${titlePrefix}: ${concorso.title}*\n\n` +
            `_${shortDesc}_\n\n` +
            `🗓️ *Inizio:* ${startDate}\n\n` +
            `[Vedi Dettagli](${concorso.source})\n` +
            `[Leggi Regolamento](${concorso.rulesUrl})`;

        const channelsKey = `${this.getStrategyId().toUpperCase()}_NOTIFY_CHANNELS`;
        const channelsConfig = this.configService.get<string>(channelsKey);
        const targetChannels = channelsConfig ? channelsConfig.split(',').map(c => c.trim()).filter(Boolean) : null;

        return {
            payload: {
                message,
                imageUrl: concorso.images?.[0] || null,
                disableNotification: true
            },
            channels: targetChannels
        };
    }

    public formatSummary(
        results: ProcessResult<Concorso>[],
        totalChildren: number,
        failedCount: number,
        strategyId: string,
    ): TargetedNotification {
        const createdCount = results.filter(r => r.status === 'created').length;
        const updatedCount = results.filter(r => r.status === 'updated').length;
        const unchangedCount = results.filter(r => r.status === 'unchanged').length;

        const shouldNotify = createdCount > 0 || updatedCount > 0 || failedCount > 0;
        if (!shouldNotify && unchangedCount > 0) return null;

        const summaryMessage = `*📊 Scan Summary: ${this.friendlyName}*\n\n` +
            `✅ *New:* ${createdCount}\n` +
            `🔄 *Updated:* ${updatedCount}\n` +
            `ℹ️ *Unchanged:* ${unchangedCount}\n` +
            `❌ *Failed:* ${failedCount}\n\n` +
            `*Total processed:* ${totalChildren}`;

        const channelsKey = `${strategyId.toUpperCase()}_NOTIFY_CHANNELS`;
        const channelsConfig = this.configService.get<string>(channelsKey);
        const targetChannels = channelsConfig ? channelsConfig.split(',').map(c => c.trim()).filter(Boolean) : null;

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