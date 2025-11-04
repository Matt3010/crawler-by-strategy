import { Controller, Post, Get, HttpException, HttpStatus, Query } from '@nestjs/common';
import { CrawlerService } from './crawler.service';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiTags('Admin - Crawler')
@Controller('admin/crawl')
export class CrawlerController {
  constructor(private readonly crawlerService: CrawlerService) {}

  @Post('run')
  @ApiOperation({ summary: 'Forza l\'esecuzione del crawler (Aggiunge job alla coda)' })
  async forceCrawl(): Promise<any> {
    try {
      return await this.crawlerService.forceCrawl();
    } catch (error) {
      throw new HttpException('Errore nell\'aggiunta dei job alla coda', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('logs')
  @ApiOperation({ summary: 'Visualizza gli ultimi log del crawler da Redis' })
  @ApiQuery({ name: 'count', required: false, description: 'Numero di log da recuperare (default 100)'})
  async getLogs(@Query('count') count?: string): Promise<{ logs: string[] }> {
    const logCount: number = count ? parseInt(count, 10) : 100;
    return {
      logs: await this.crawlerService.getLogs(logCount),
    };
  }
}
