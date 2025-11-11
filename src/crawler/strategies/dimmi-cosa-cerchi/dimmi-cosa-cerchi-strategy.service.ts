import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConcorsiService } from 'src/concorsi/concorsi.service';
import { BaseDimmiCosaCerchiStrategy } from './base-dimmi-cosa-cerchi.strategy';

@Injectable()
export class DimmiCosaCerchiStrategy extends BaseDimmiCosaCerchiStrategy {
    readonly friendlyName: string = 'DimmiCosaCerchi';
    readonly MAX_PAGES_TO_SCRAPE: number = 3;
    readonly LIST_ITEM_SELECTOR: string = 'h2.entry-title a.p-url';
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
    ) {
        super(configService, concorsiService);
    }

    getStrategyId(): string {
        return 'dimmicosacerchi';
    }

    getBaseUrl(): string {
        return 'https://www.dimmicosacerchi.it/concorsi-a-premi';
    }
}