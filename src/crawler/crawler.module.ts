import { Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { CrawlerService } from './crawler.service';
import { CrawlerController } from './crawler.controller';
import { ConcorsiModule } from '../activities/concorsi/concorsi.module';
import { VinciteModule } from '../activities/vincite/vincite.module';
import { DimmiCosaCerchiStrategy } from '../activities/concorsi/strategies/dimmi-cosa-cerchi/dimmi-cosa-cerchi-strategy.service';
import { DimmiCosaCerchiTravelStrategy } from "../activities/concorsi/strategies/dimmi-cosa-cerchi/dimmi-cosa-cerchi-travel-strategy.service";
import { SoldissimiVinciteStrategy } from '../activities/vincite/strategies/soldissimi-vincite.strategy';
import { BullModule } from '@nestjs/bullmq';
import { ScanWorker } from './scan.worker';
import { SummaryWorker } from './summary.worker';
import { FlowProducer } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
    SCAN_QUEUE_NAME,
    DETAIL_QUEUE_NAME,
    SUMMARY_QUEUE_NAME,
    FLOW_PRODUCER,
    CRAWLER_STRATEGIES_TOKEN
} from './crawler.constants';
import { DetailWorker } from './detail.worker';
import { StrategyRegistry } from './strategy.registry.service';
import { ICrawlerStrategy } from './strategies/crawler.strategy.interface';

const strategyProviders = [
    DimmiCosaCerchiStrategy,
    DimmiCosaCerchiTravelStrategy,
    SoldissimiVinciteStrategy
];

const flowProducerProvider = {
    provide: FLOW_PRODUCER,
    inject: [ConfigService],
    useFactory: (configService: ConfigService): FlowProducer => {
        const connection = {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
        };
        return new FlowProducer({ connection });
    },
};

@Module({
    imports: [
        ConcorsiModule,
        VinciteModule,
        BullModule.registerQueue(
            { name: SCAN_QUEUE_NAME },
            { name: DETAIL_QUEUE_NAME },
            { name: SUMMARY_QUEUE_NAME },
        ),
    ],
    providers: [
        CrawlerService,
        ScanWorker,
        DetailWorker,
        SummaryWorker,
        flowProducerProvider,
        StrategyRegistry,
        ...strategyProviders,
        {
            provide: CRAWLER_STRATEGIES_TOKEN,
            useFactory: (...strategies: ICrawlerStrategy[]): ICrawlerStrategy[] => strategies,
            inject: strategyProviders,
        },
    ],
    controllers: [CrawlerController],
})
export class CrawlerModule implements OnModuleDestroy {
    constructor(
        @Inject(FLOW_PRODUCER) private readonly flowProducer: FlowProducer,
    ) {}

    public onModuleDestroy(): void {
        this.flowProducer.close().then();
    }
}