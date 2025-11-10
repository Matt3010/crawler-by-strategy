import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlConcorsoDto } from 'src/concorsi/dto/crawl-concorso.dto';
import { ICrawlerStrategy, ProcessResult } from './crawler.strategy.interface';
import * as cheerio from 'cheerio';
import { ConcorsiService } from 'src/concorsi/concorsi.service';
import { Concorso } from 'src/concorsi/entities/concorso.entity';
import { TargetedNotification } from 'src/notification/notification.types';
import {Cheerio, CheerioAPI} from "cheerio";

// Month mapping helper
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
    private readonly logger = new Logger(DimmiCosaCerchiStrategy.name);
    private readonly MAX_PAGES_TO_SCRAPE = 6;
    private readonly proxyUrl: string;

    private readonly friendlyName: string = 'DimmiCosaCerchi';

    private readonly LIST_ITEM_SELECTOR: string = 'h2.entry-title a.p-url';
    private readonly LIST_NEXT_PAGE_SELECTOR: string = 'a.next.page-numbers';
    private readonly DETAIL_TITLE_SELECTOR: string = 'h1.s-title';
    private readonly DETAIL_DESCRIPTION_SELECTOR: string = '.entry-content p';
    private readonly DETAIL_CONTENT_SELECTOR: string = '.entry-content';
    private readonly DETAIL_RULES_LINK_SELECTOR: string = '.entry-content a';
    private readonly DETAIL_IMAGE_SELECTOR_TWITTER: string = 'meta[name="twitter:image"]';
    private readonly DETAIL_IMAGE_SELECTOR_OG: string = 'meta[property="og:image"]';

    private readonly DATE_REGEX_RANGE: RegExp = /dal (\d+°? \w+ \d{4})\s+al\s+(\d+°? \w+ \d{4})/i;
    private readonly DATE_REGEX_DEADLINE: RegExp = /(fino al|entro e non oltre il|entro il|scade il)\s+(\d+°? \w+ \d{4})/i;

    private delay(ms: number): Promise<void> {
        return new Promise((resolve: (value: (PromiseLike<void> | void)) => void) => setTimeout(resolve, ms));
    }

    constructor(
        private readonly configService: ConfigService,
        private readonly concorsiService: ConcorsiService,
    ) {
        this.proxyUrl = this.configService.get<string>('MY_PROXY_URL');
        if (this.proxyUrl) {
            this.logger.log(`Strategy configured to use Vercel proxy: ${this.proxyUrl}`);
        } else {
            this.logger.error('!!! MY_PROXY_URL not set in .env. The scraper will fail. !!!');
        }
    }

    getStrategyId(): string {
        return 'dimmicosacerchi';
    }

    getBaseUrl(): string {
        return 'https://www.dimmicosacerchi.it/concorsi-a-premi';
    }

    private async fetchHtml(targetUrl: string): Promise<string> {
        if (!this.proxyUrl) throw new Error('Proxy URL not configured.');

        const randomDelay: number = Math.floor(Math.random() * 2000) + 500;
        await this.delay(randomDelay);
        const fetchUrl = `${this.proxyUrl}?url=${encodeURIComponent(targetUrl)}`;

        this.logger.log(`Fetching ${fetchUrl} (after ${randomDelay}ms delay)`);

        const response: Response = await fetch(fetchUrl);
        if (!response.ok) {
            const message = `Proxy fetch failed with status ${response.status} for ${targetUrl}`;
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

    async runListing(log: (message: string) => void, baseUrl: string): Promise<string[]> {
        log(`[${this.getStrategyId()}] Starting list scan: ${baseUrl}`);
        const allDetailLinks = new Set<string>();
        let currentPageUrl: string | null = baseUrl;
        let pageCounter: number = 1;

        try {
            while (currentPageUrl && pageCounter <= this.MAX_PAGES_TO_SCRAPE) {
                log(`[${this.getStrategyId()}] Scanning list page: ${currentPageUrl} (Page ${pageCounter})`);
                const html: string = await this.fetchHtml(currentPageUrl);
                const $: CheerioAPI = cheerio.load(html);
                const linksOnThisPage: string[] = [];

                $(this.LIST_ITEM_SELECTOR).each((_: number, el): void => {
                    const href: string = $(el).attr('href');
                    if (href) linksOnThisPage.push(href);
                });

                if (linksOnThisPage.length === 0) {
                    log(`[${this.getStrategyId()}] No links found on page ${pageCounter}. Stopping pagination.`);
                    break;
                }

                linksOnThisPage.forEach((link: string): Set<string> => allDetailLinks.add(link));
                pageCounter++;

                const nextButton: Cheerio<any>  = $(this.LIST_NEXT_PAGE_SELECTOR);
                currentPageUrl = nextButton ? nextButton.attr('href') || null : null;
            }

            log(`[${this.getStrategyId()}] List scan complete. Found ${allDetailLinks.size} unique links.`);
            return Array.from(allDetailLinks);
        } catch (error) {
            log(`[${this.getStrategyId()}] ERROR in runListing: ${error.message}`);
            throw error;
        }
    }

    private _extractDatesFromText(contentText: string): { startDate: Date, endDate: Date } {
        let startDateStr: string | null = null;
        let endDateStr: string | null = null;

        let match: RegExpExecArray = this.DATE_REGEX_RANGE.exec(contentText);
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
            const fallbackEndDate = new Date();
            fallbackEndDate.setDate(fallbackEndDate.getDate() + 30);
            endDateStr = fallbackEndDate.toISOString().split('T')[0];
            this.logger.warn(`End date not found. Fallback set to +30 days: ${endDateStr}`);
        }

        return {
            startDate: new Date(startDateStr),
            endDate: new Date(endDateStr),
        };
    }

    async runDetail(link: string, log: (message: string) => void): Promise<Omit<CrawlConcorsoDto, 'brand'>> {
        const html: string = await this.fetchHtml(link);
        const $: CheerioAPI = cheerio.load(html);

        const title: string = $(this.DETAIL_TITLE_SELECTOR).text().trim() || 'Title not found';
        const description = $(this.DETAIL_DESCRIPTION_SELECTOR).first().text().trim() || '';

        let rulesUrl: string | undefined = null;
        $(this.DETAIL_RULES_LINK_SELECTOR).each((_, el) => {
            if ($(el).text().toLowerCase().includes('regolamento')) {
                rulesUrl = $(el).attr('href');
                return false;
            }
        });

        const contentText = $(this.DETAIL_CONTENT_SELECTOR).text() || '';

        const images: string[] = [];
        const imageUrl =
            $(this.DETAIL_IMAGE_SELECTOR_TWITTER).attr('content') ||
            $(this.DETAIL_IMAGE_SELECTOR_OG).attr('content');

        if (imageUrl) {
            const absoluteUrl = new URL(imageUrl, new URL(link).origin).href;
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

    async processDetail(detailData: Omit<CrawlConcorsoDto, 'brand'>): Promise<ProcessResult> {
        const dto: CrawlConcorsoDto = { ...detailData, brand: this.getStrategyId() };
        const result = await this.concorsiService.createOrUpdateFromCrawl(dto);
        return { status: result.status, entity: result.concorso };
    }

    public formatSummary(
        results: ProcessResult[],
        totalChildren: number,
        failedCount: number,
        strategyId: string,
    ): TargetedNotification {
        const grouped: Record<string, Concorso[]> = { created: [], updated: [], unchanged: [] };

        for (const result of results) {
            const concorso = result.entity as Concorso;
            grouped[result.status]?.push(concorso);
        }

        const heroImageUrl = grouped.created[0]?.images?.[0] ?? grouped.updated[0]?.images?.[0];

        const buildSection = (items: Concorso[], emoji: string, title: string) =>
            items.length === 0
                ? ''
                : `*${emoji} ${title} ${items.length}:*\n` +
                items
                    .map(c => {
                        const shortDesc = c.description.substring(0, 80).trimEnd() + '...';
                        return `*${c.title}*\n_${shortDesc}_\n[View Details](${c.source}) | [Read Rules](${c.rulesUrl})`;
                    })
                    .join('\n\n') + '\n\n';

        let summaryMessage = `*Contest Updates from ${this.friendlyName}*\n\n`;
        summaryMessage += buildSection(grouped.created, '✅', 'New Contests');
        summaryMessage += buildSection(grouped.updated, '🔄', 'Updated Contests');

        if (grouped.unchanged.length > 0) {
            summaryMessage += `*ℹ️ ${grouped.unchanged.length} contests checked (no changes).*\n\n`;
        }

        if (!grouped.created.length && !grouped.updated.length && failedCount === 0) {
            summaryMessage += `✅ No new updates. All contests are already synced!\n\n`;
        }

        if (failedCount > 0) {
            summaryMessage += `*❌ WARNING: ${failedCount} (of ${totalChildren}) items failed to process.*\n(Check logs for details.)\n\n`;
        }

        summaryMessage += `*Final Summary:* ${grouped.created.length} new, ${grouped.updated.length} updated, ${grouped.unchanged.length} unchanged, ${failedCount} failed.`;

        const channelsKey = `${strategyId.toUpperCase()}_NOTIFY_CHANNELS`;
        const channelsConfig = this.configService.get<string>(channelsKey);
        const targetChannels = channelsConfig
            ? channelsConfig.split(',').map(c => c.trim()).filter(Boolean)
            : null;

        this.logger.log(
            `[${strategyId}] Summary for ${targetChannels?.length ? 'specific channels: ' + targetChannels.join(',') : 'ALL channels'}.`
        );

        return {
            payload: { message: summaryMessage, imageUrl: heroImageUrl },
            channels: targetChannels,
        };
    }

}