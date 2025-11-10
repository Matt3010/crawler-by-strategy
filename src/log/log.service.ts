import { Injectable, Inject, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class LogService implements OnModuleDestroy {
  private readonly logger: Logger = new Logger(LogService.name);
  private readonly LOG_KEY: string = 'crawler:logs';
  private readonly MAX_LOG_SIZE: number = 500;

  constructor(@Inject('REDIS_LOG_CLIENT') private readonly redis: Redis) {}

  async add(message: string): Promise<void> {
    try {
      const logEntry = `[${new Date().toISOString()}] ${message}`;
      await this.redis.lpush(this.LOG_KEY, logEntry);
      await this.redis.ltrim(this.LOG_KEY, 0, this.MAX_LOG_SIZE - 1);
    } catch (error) {
      this.logger.error(`Fallimento scrittura log su Redis: ${error.message}`);
    }
  }

  async get(count = 100): Promise<string[]> {
    try {
      return await this.redis.lrange(this.LOG_KEY, 0, count - 1);
    } catch (error) {
      this.logger.error(`Fallimento lettura log da Redis: ${error.message}`);
      return ['Errore nel recuperare i log da Redis.'];
    }
  }

  async clear(): Promise<void> {
     try {
       await this.redis.del(this.LOG_KEY);
     } catch (error) {
       this.logger.error(`Fallimento pulizia log Redis: ${error.message}`);
     }
  }

  public onModuleDestroy(): void {
    this.redis.quit();
  }
}
