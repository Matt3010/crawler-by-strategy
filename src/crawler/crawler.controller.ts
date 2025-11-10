import { Controller, Post, Get, HttpException, HttpStatus, Query, Param } from '@nestjs/common';
import { CrawlerService } from './crawler.service';
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';

@ApiTags('Admin - Crawler')
@Controller('admin/crawl')
export class CrawlerController {
    constructor(private readonly crawlerService: CrawlerService) {}

    @Post('run')
    @ApiOperation({ summary: 'Force execution of ALL active strategies' })
    async forceCrawl(): Promise<any> {
        return await this.crawlerService.forceCrawl();
    }

    @Post('run/:strategyId')
    @ApiOperation({ summary: 'Force execution of a SINGLE strategy' })
    @ApiParam({
        name: 'strategyId',
        required: true,
        description: 'ID of the strategy to execute (e.g. dimmicosacerchi)',
        example: 'dimmicosacerchi'
    })
    async forceCrawlStrategy(@Param('strategyId') strategyId: string): Promise<any> {
        try {
            return await this.crawlerService.forceCrawlStrategy(strategyId);
        } catch (error) {
            if (error.message.includes('not found or not active')) {
                throw new HttpException(error.message, HttpStatus.NOT_FOUND);
            }
            this.crawlerService.getLogger().error(`Unexpected error in forceCrawlStrategy: ${error.message}`, error.stack);
            throw new HttpException('Internal error during crawl startup', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('logs')
    @ApiOperation({ summary: 'View the latest crawler logs from Redis' })
    @ApiQuery({ name: 'count', required: false, description: 'Number of logs to retrieve (default 100)' })
    async getLogs(@Query('count') count?: string): Promise<{ logs: string[] }> {
        const logCount: number = count ? Number.parseInt(count, 10) : 100;
        return {
            logs: await this.crawlerService.getLogs(logCount),
        };
    }
}
