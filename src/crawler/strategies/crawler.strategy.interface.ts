import { TargetedNotification } from 'src/notification/notification.types';

export type CrawlStatus = 'created' | 'updated' | 'unchanged';

export interface ProcessResult<TEntity = any> {
    status: CrawlStatus;
    entity: TEntity;
    individualNotification?: TargetedNotification | null;
}

export interface ICrawlerStrategy<TEntity = any, TDetailDto = any> {
    getStrategyId(): string;

    getBaseUrl(): string;

    runListing(log: (message: string) => void, baseUrl: string): Promise<string[]>;

    runDetail(link: string, log: (message: string) => void): Promise<TDetailDto>;

    processDetail(detailData: TDetailDto, log?: (message: string) => void): Promise<ProcessResult<TEntity>>;

    formatSummary(
        results: ProcessResult<TEntity>[],
        totalChildren: number,
        failedCount: number,
        strategyId: string,
    ): TargetedNotification | null;
}