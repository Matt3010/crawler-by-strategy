# Extensible Web Crawler Framework

This repository provides a **robust, extensible, and Docker-ready framework** for building and managing web crawlers.  
It is built on **NestJS** and uses a powerful **async queue system (BullMQ)** to orchestrate complex scraping flows, from listing and detail extraction to data processing and notification.

The entire system is designed around a **Strategy Pattern**, allowing you to easily add new data sources (websites) or new notification channels (like Slack, Discord, etc.) with minimal effort.

---

## 🧠 Core Features

### 🚀 Docker-Ready
Includes multi-stage Dockerfile for optimized production builds and docker-compose files for both development and production.

### 🧩 Extensible Crawler Architecture
Add new websites to scrape by simply implementing the `ICrawlerStrategy` interface.  
The system's `StrategyRegistry` automatically discovers and manages them.

### ⚙️ Async Queue Processing
Uses a powerful **BullMQ flow** with three distinct queues (**scan**, **detail**, **summary**) to manage scraping jobs asynchronously, ensuring resilience and scalability.

### 🔔 Dynamic Notification System
Features an `INotificationStrategy` that is dynamically configured via `.env` variables.  
Send results to different channels (like Telegram) based on the data source.

### 💾 Persistent Storage
Uses **TypeORM (Postgres)** to store results.  
The `Concorso` entity serves as a model, but you can adapt it to any data structure you need.

### 📟 Centralized Logging
All workers and services write to a centralized `LogService` backed by Redis, viewable via an admin endpoint.

### ⏰ Scheduled & Manual Execution
Jobs can be triggered automatically via **Cron schedules** or manually through a secure **admin API**.

### 📚 API Documentation
Automatically generates **Swagger (OpenAPI)** documentation for all API endpoints.

---

## 🚀 Getting Started (Docker)

This application is fully containerized.  
The only prerequisite is **Docker** and **Docker Compose**.

---

### 1. Environment Configuration

The system is configured entirely through environment variables.

Copy the example `.env` file (not provided, but implied by `.dockerignore`):

```bash
cp .env.example .env
````

Edit your `.env` file. The `docker-compose.yml` and `docker-compose-prod.yml` files list all required variables.

**Key variables you MUST set:**

| Variable                  | Description                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_USER`           | Your database username                                                                                                                       |
| `POSTGRES_PASSWORD`       | Your database password                                                                                                                       |
| `POSTGRES_DB`             | Your database name                                                                                                                           |
| `ACTIVE_STRATEGIES`       | Comma-separated list of crawler strategy IDs (e.g. `my_first_scraper,my_second_scraper`)                                                     |
| `NOTIFICATION_STRATEGIES` | Comma-separated list of notification channel IDs (e.g. `my_telegram_channel`)                                                                |
| ...                       | Other variables for your specific strategies (e.g. `MY_TELEGRAM_CHANNEL_TYPE=telegram`, `MY_TELEGRAM_CHANNEL_TOKEN=...`, `MY_PROXY_URL=...`) |

---

### 2. Running in Development

The development compose file uses `build: .` to build your local code and mounts volumes for hot-reloading.

```bash
# Build backend, DB, and Redis containers
docker-compose up -d --build
```

* **API:** [http://localhost:3000/api](http://localhost:3000/api)
* **API Docs:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

---

### 3. Running in Production

The production compose file assumes you have a pre-built image in a registry (like Docker Hub)
and includes **Watchtower** for automatic updates.

```bash
# Pull the 'latest' images and start the stack
docker-compose -f docker-compose-prod.yml up -d
```

---

## 🔧 How to Extend the Framework

This is where the framework's power lies.
You don’t need to modify the core engine — you just add new “plugins” (**Strategies**).

---

### 1. How to Add a New Crawler

Suppose you want to scrape `my-new-site.com`.

#### Step 1. Create the Strategy Class

Create a new file (e.g. `my-new-site.strategy.ts`) and implement the `ICrawlerStrategy` interface.

```typescript
import { Injectable } from '@nestjs/common';
import { ICrawlerStrategy, ProcessResult } from './crawler.strategy.interface';
// ... other imports

@Injectable()
export class MyNewSiteStrategy implements ICrawlerStrategy {

    getStrategyId(): string {
        return 'mynewsite';
    }

    getBaseUrl(): string {
        return 'https://my-new-site.com/listings';
    }

    async runListing(log: (message: string), baseUrl: string): Promise<string[]> {
        log('Fetching links from the list page...');
        return ['https://my-new-site.com/item/1', 'https://my-new-site.com/item/2'];
    }

    async runDetail(link: string, log: (message: string)): Promise<Omit<CrawlConcorsoDto, 'brand'>> {
        log(`Scraping detail from: ${link}`);
        return {
            title: 'My Scraped Title',
            description: 'Scraped description.',
            startDate: new Date(),
            endDate: new Date(),
            rulesUrl: 'https://my-new-site.com/rules.pdf',
            source: link,
            sourceId: new URL(link).pathname,
            images: [],
        };
    }

    async processDetail(detailData: Omit<CrawlConcorsoDto, 'brand'>, log?: (message: string)): Promise<ProcessResult> {
        throw new Error('Method not implemented.');
    }

    formatSummary(/*...args*/): TargetedNotification {
        throw new Error('Method not implemented.');
    }
}
```

**Tip:**
Look at `base-dimmi-cosa-cerchi.strategy.ts` as a perfect example of creating a base class with shared logic (`fetchHtml`, `processDetail`, `formatSummary`) that your concrete strategies can inherit from.

#### Step 2. Register Your Strategy

Open `crawler.module.ts` and add your new class to two arrays:

```typescript
const strategyProviders = [ /* ... */ ];
```

and

```typescript
inject: [ /* inside CRAWLER_STRATEGIES_TOKEN provider */ ];
```

#### Step 3. Activate Your Strategy

Add your new ID to `.env`:

```env
ACTIVE_STRATEGIES=dimmicosacerchi,mynewsite
```

#### Step 4. (Optional) Add a Cron Job

Open `crawler.service.ts` and add a new cron method:

```typescript
@Cron(CronExpression.EVERY_DAY_AT_10AM)
public async runMyNewSiteCron(): Promise<void> {
    const strategyId = 'mynewsite';
    this.logger.warn(`--- CRON JOB STARTED [${strategyId}] ---`);
    await this.logService.add(`--- 🏁 CRON JOB STARTED (scheduled) [${strategyId}] ---`);
    await this.startCrawl([strategyId], true);
}
```

That’s it — the framework handles the rest.

---

### 2. How to Add a New Notification Channel

Suppose you want to send alerts to **Slack**.

#### Step 1. Create the Strategy Class

Create `slack.strategy.ts` and implement `INotificationStrategy`.
See `telegram.strategy.ts` for reference.

```typescript
import { INotificationStrategy } from './notification.strategy.interface';
// ...
export class SlackNotificationStrategy implements INotificationStrategy {
    constructor(private readonly id: string, private readonly webhookUrl: string) {}

    getStrategyId(): string {
        return this.id;
    }

    async sendNotification(payload: NotificationPayload): Promise<void> {
        await fetch(this.webhookUrl, {
            method: 'POST',
            body: JSON.stringify({ text: payload.message }),
        });
    }
}
```

#### Step 2. Register the New Type

Open `notification.service.ts` and update the `buildStrategyList` method:

```typescript
if (type === 'telegram') {
    strategy = this.buildTelegramStrategy(id);
} else if (type === 'slack') { // <-- ADD THIS BLOCK
    const webhook: string = this.configService.get<string>(`${id.toUpperCase()}_WEBHOOK`);
    if (webhook) {
        strategy = new SlackNotificationStrategy(id, webhook);
    }
} else {
    this.logger.warn(`Strategy type "${type}" for ID "${id}" not recognized.`);
}
```

#### Step 3. Activate in `.env`

```env
# Add your new ID to the list
NOTIFICATION_STRATEGIES=my_telegram,my_slack_channel

# Configure your new strategy
MY_SLACK_CHANNEL_TYPE=slack
MY_SLACK_CHANNEL_WEBHOOK=https://hooks.slack.com/services/...
```

---

## ⚖️ Legal Disclaimer

Web scraping can be a **legally gray area** and may be explicitly forbidden by the terms of service of many websites.

You are **solely responsible** for what you scrape.
Before implementing a crawler for any website, review its **Terms of Service** (robots.txt is **not** legally binding) to ensure compliance.

The author(s) of this repository assume **no liability** and are **not responsible** for any misuse, damages, or legal action that may result from your use of this software.

This tool is provided for **educational and illustrative purposes only**.
Use it **responsibly and at your own risk**.