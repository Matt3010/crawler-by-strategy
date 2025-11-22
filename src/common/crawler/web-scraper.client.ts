import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WebScraperClient {
    private readonly logger: Logger = new Logger(WebScraperClient.name);
    private readonly proxyUrl: string | undefined;

    constructor(private readonly configService: ConfigService) {
        this.proxyUrl = this.configService.get<string>('MY_PROXY_URL');
        if (!this.proxyUrl) {
            this.logger.warn('MY_PROXY_URL not configured. Scraper might fail on protected sites.');
        }
    }

    public async fetchHtml(url: string, useProxy = true): Promise<string> {
        await this.randomDelay(500, 4000);

        let fetchUrl: string = url;
        const headers: HeadersInit = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        if (useProxy && this.proxyUrl) {
            fetchUrl = `${this.proxyUrl}?url=${encodeURIComponent(url)}`;
        }

        this.logger.debug(`Fetching: ${url} ${useProxy ? '(via Proxy)' : ''}`);

        try {
            const response: Response = await fetch(fetchUrl, { headers });

            if (!response.ok) {
                throw new Error(`Fetch failed with status: ${response.status}`);
            }

            return await response.text();
        } catch (error) {
            const msg: string = error instanceof Error ? error.message : String(error);
            this.logger.error(`Network Error on ${url}: ${msg}`);
            throw error;
        }
    }

    public async randomDelay(min = 500, max = 1500): Promise<void> {
        const ms: number = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise((resolve: (value: (PromiseLike<void>)) => void): number => setTimeout(resolve, ms));
    }
}