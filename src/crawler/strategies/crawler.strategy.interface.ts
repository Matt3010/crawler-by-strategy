import { CrawlStatus } from 'src/concorsi/concorsi.service';
import { TargetedNotification } from 'src/notification/notification.types';

export type ProcessResult = {
    status: CrawlStatus;
    entity: any;
};

export interface ICrawlerStrategy {
    getStrategyId(): string;
    getBaseUrl(): string;
    runListing(logger: (message: string) => void, baseUrl: string): Promise<string[]>;
    runDetail(link: string, logger: (message: string) => void): Promise<any>;
    processDetail(
        detailData: any,
        logger: (message: string) => void,
    ): Promise<ProcessResult>;
    formatSummary(
        results: ProcessResult[],
        totalChildren: number,
        failedCount: number,
        strategyId: string,
    ): TargetedNotification;
}