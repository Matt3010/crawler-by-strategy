import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConcorsiService } from 'src/activities/concorsi/concorsi.service';
import { BaseDimmiCosaCerchiStrategy } from './base-dimmi-cosa-cerchi.strategy';
import {WebScraperClient} from "../../../../common/crawler/web-scraper.client";

@Injectable()
export class DimmiCosaCerchiTravelStrategy extends BaseDimmiCosaCerchiStrategy {

    readonly friendlyName: string = 'DimmiCosaCerchi Travel';
    readonly MAX_PAGES_TO_SCRAPE: number = 1;
    readonly LIST_ITEM_SELECTOR: string = 'h3.entry-title a.p-url';
    readonly LIST_NEXT_PAGE_SELECTOR: string = 'a.next.page-numbers';
    readonly DETAIL_TITLE_SELECTOR: string = 'h1.s-title';
    readonly DETAIL_DESCRIPTION_SELECTOR: string = '.entry-content p';
    readonly DETAIL_CONTENT_SELECTOR: string = '.entry-content';
    readonly DETAIL_RULES_LINK_SELECTOR: string = '.entry-content a';
    readonly DETAIL_IMAGE_SELECTOR_TWITTER: string = 'meta[name="twitter:image"]';
    readonly DETAIL_IMAGE_SELECTOR_OG: string = 'meta[property="og:image"]';

    constructor(
        protected readonly configService: ConfigService,
        protected readonly concorsiService: ConcorsiService,
        protected readonly scraperClient: WebScraperClient,
    ) {
        super(scraperClient, concorsiService, configService);
    }

    getStrategyId(): string {
        return 'dimmicosacerchitravel';
    }

    getBaseUrl(): string {
        return 'https://www.dimmicosacerchi.it/tag/vinci-soggiorni';
    }
}