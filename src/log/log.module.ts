import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LogService } from './log.service';
import Redis from 'ioredis';

const redisProvider = {
  provide: 'REDIS_LOG_CLIENT',
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    return new Redis({
      host: configService.get<string>('REDIS_HOST', 'localhost'),
      port: configService.get<number>('REDIS_PORT', 6379),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  },
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [redisProvider, LogService],
  exports: [LogService],
})
export class LogModule {}
