import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ICrawlerStrategy } from './strategies/crawler.strategy.interface';
import { CRAWLER_STRATEGIES_TOKEN } from './crawler.constants';

@Injectable()
export class StrategyRegistry implements OnModuleInit {
    private readonly logger: Logger = new Logger(StrategyRegistry.name);
    private readonly strategies: Map<string, ICrawlerStrategy> = new Map<string, ICrawlerStrategy>();

    constructor(
        @Inject(CRAWLER_STRATEGIES_TOKEN)
        private readonly strategyImplementations: ICrawlerStrategy[],
    ) {}

    public onModuleInit(): void {
        if (!this.strategyImplementations || this.strategyImplementations.length === 0) {
            this.logger.warn('No crawler strategies were injected!');
            return;
        }

        for (const strategy of this.strategyImplementations) {
            const strategyId: string = strategy.getStrategyId();
            if (this.strategies.has(strategyId)) {
                this.logger.warn(`Duplicate strategy ID found: ${strategyId}. Overwriting.`);
            }
            this.strategies.set(strategyId, strategy);
        }
        this.logger.log(`Registered ${this.strategies.size} crawler strategies: [${Array.from(this.strategies.keys()).join(', ')}]`);
    }

    public get(strategyId: string): ICrawlerStrategy | undefined {
        const strategy: ICrawlerStrategy = this.strategies.get(strategyId);
        if (!strategy) {
            this.logger.error(`Strategy with ID "${strategyId}" not found in registry.`);
        }
        return strategy;
    }

    public getAll(): ICrawlerStrategy[] {
        return Array.from(this.strategies.values());
    }
}