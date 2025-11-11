import { Concorso } from 'src/concorsi/entities/concorso.entity';
import { CrawlStatus } from 'src/concorsi/concorsi.service';
import { CrawlConcorsoDto } from 'src/concorsi/dto/crawl-concorso.dto';
import { TargetedNotification } from 'src/notification/notification.types';

export interface ProcessResult {
    status: CrawlStatus;
    entity: Concorso;
    individualNotification?: TargetedNotification | null;
}

export interface ICrawlerStrategy {
    getStrategyId(): string;

    getBaseUrl(): string;

    runListing(log: (message: string) => void, baseUrl: string): Promise<string[]>;

    runDetail(link: string, log: (message: string) => void): Promise<Omit<CrawlConcorsoDto, 'brand'>>;

    processDetail(detailData: Omit<CrawlConcorsoDto, 'brand'>, log?: (message: string) => void): Promise<ProcessResult>;

    formatSummary(
        results: ProcessResult[],
        totalChildren: number,
        failedCount: number,
        strategyId: string,
    ): TargetedNotification;
}