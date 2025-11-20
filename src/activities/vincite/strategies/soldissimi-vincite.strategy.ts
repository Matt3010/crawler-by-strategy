import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cheerio from 'cheerio';
import { URL } from 'url';

import { TargetedNotification } from 'src/notification/notification.types';
import { CrawlVincitaDto } from '../dto/crawl-vincita.dto';
import { ICrawlerStrategy, ProcessResult } from '../../../crawler/strategies/crawler.strategy.interface';
import { VinciteService } from '../vincite.service';
import { Vincita } from '../entities/vincita.entity';

@Injectable()
export class SoldissimiVinciteStrategy implements ICrawlerStrategy<Vincita, CrawlVincitaDto> {
    private readonly logger: Logger = new Logger(SoldissimiVinciteStrategy.name);
    private readonly proxyUrl: string;

    readonly friendlyName: string = 'Soldissimi Vincite';
    readonly BASE_URL: string = 'https://www.soldissimi.it/forum/forum/concorsi-a-premi-gioca-e-vinci-con-noi/vincite';
    readonly MAX_PAGES: number = 2;

    constructor(
        protected readonly configService: ConfigService,
        protected readonly vinciteService: VinciteService,
    ) {
        this.proxyUrl = this.configService.get<string>('MY_PROXY_URL');
    }

    getStrategyId(): string {
        return 'soldissimi_vincite';
    }

    getBaseUrl(): string {
        return this.BASE_URL;
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve: (value: (PromiseLike<void> | void)) => void) => setTimeout(resolve, ms));
    }

    protected async fetchHtml(targetUrl: string): Promise<string> {
        if (!this.proxyUrl) throw new Error('Proxy URL not configured.');
        await this.delay(Math.floor(Math.random() * 1500) + 500);

        const fetchUrl = `${this.proxyUrl}?url=${encodeURIComponent(targetUrl)}`;
        this.logger.log(`Fetching Listing: ${targetUrl}`);

        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
        return await response.text();
    }

    public async runListing(log: (message: string) => void, baseUrl: string): Promise<string[]> {
        log(`[${this.getStrategyId()}] Scan start: ${baseUrl}`);
        const allTopicLinks: Set<string> = new Set();
        let currentPageUrl: string | null = baseUrl;
        let pageCounter = 1;

        try {
            while (currentPageUrl && pageCounter <= this.MAX_PAGES) {
                const html = await this.fetchHtml(currentPageUrl);
                const $ = cheerio.load(html);

                const topicRows = $('tr.topic-item');

                if (topicRows.length === 0) break;

                topicRows.each((_, el) => {
                    const row = $(el);
                    const linkEl = row.find('a.topic-title');

                    const titleText = linkEl.text().trim();

                    const href = linkEl.attr('href');

                    if (href && titleText) {
                        const absoluteLink = href.startsWith('http') ? href : `https://www.soldissimi.it/forum/${href}`;

                        const viewsText = row.find('.cell-count .views-count').text().trim();
                        const views = viewsText.replace(/\D/g, '') || '0';

                        const winnerName = row.find('.topic-info a').first().text().trim() || 'Anonimo';

                        const urlObj = new URL(absoluteLink);
                        urlObj.searchParams.set('meta_views', views);
                        urlObj.searchParams.set('meta_winner', winnerName);
                        urlObj.searchParams.set('meta_title', titleText);

                        allTopicLinks.add(urlObj.toString());

                        log(`Found: ${titleText} | Winner: ${winnerName}`);
                    }
                });

                pageCounter++;
                const nextButton = $('a.arrow.right-arrow').not('.h-disabled');
                currentPageUrl = nextButton.attr('href') || null;
            }
        } catch (e) {
            this.logger.error(`Listing failed: ${e.message}`);
        }

        return Array.from(allTopicLinks);
    }

    public async runDetail(link: string, log: (message: string) => void): Promise<CrawlVincitaDto> {
        const urlObj = new URL(link);

        const views = parseInt(urlObj.searchParams.get('meta_views') || '0', 10);
        const winnerName = urlObj.searchParams.get('meta_winner') || 'Anonimo';
        const title = urlObj.searchParams.get('meta_title') || 'Vincita senza titolo';

        const source = link.split('?')[0];

        const idMatch = source.match(/\/(\d+)-/);
        const sourceId = idMatch ? idMatch[1] : Buffer.from(source).toString('base64');

        const wonAt = new Date();
        const content = title;

        return {
            sourceId,
            title,
            source,
            winnerName,
            content,
            wonAt,
            brand: 'soldissimi',
            views: views
        };
    }

    public async processDetail(detailData: CrawlVincitaDto, log?: (message: string) => void): Promise<ProcessResult<Vincita>> {
        const result = await this.vinciteService.createOrUpdateFromCrawl(detailData);

        let notification: TargetedNotification | null = null;
        if (result.status === 'created') {
            notification = this._formatNotification(result.vincita);
        }

        return {
            status: result.status,
            entity: result.vincita,
            individualNotification: notification
        };
    }

    private _formatNotification(vincita: Vincita): TargetedNotification {
        const msg = `*🏆 Nuova Vincita su ${this.friendlyName}!*\n\n` +
            `👤 *Utente:* ${vincita.winnerName}\n` +
            `🎁 *Premio:* ${vincita.title}\n` +
            `👀 *Visite:* ${vincita.views}\n\n` +
            `[Vedi Discussione](${vincita.source})`;

        return {
            payload: {
                message: msg,
                imageUrl: null,
            },
            channels: this.configService.get<string>('SOLDISSIMI_NOTIFY_CHANNELS')?.split(','),
        };
    }

    public formatSummary(results: ProcessResult<Vincita>[], totalChildren: number, failedCount: number, strategyId: string): TargetedNotification {
        const created = results.filter((r: ProcessResult<Vincita>): boolean => r.status === 'created').length;

        if (created === 0 && failedCount === 0) return null;

        return {
            payload: {
                message: `📊 *Report Vincite Soldissimi*\n\n✅ Nuove vincite: ${created}\n❌ Errori: ${failedCount}`,
                imageUrl: null
            },
            channels: null
        };
    }
}