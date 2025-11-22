import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ConcorsiModule } from './activities/concorsi/concorsi.module';
import { CrawlerModule } from './crawler/crawler.module';
import { Concorso } from './activities/concorsi/entities/concorso.entity';
import { BullModule } from '@nestjs/bullmq';
import { LogModule } from './log/log.module';
import { NotificationModule } from './notification/notification.module';
import {Vincita} from "./activities/vincite/entities/vincita.entity";
import {VinciteModule} from "./activities/vincite/vincite.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): {
          type: "postgres";
          host: string;
          port: number;
          username: string;
          password: string;
          database: string;
          entities: any;
          synchronize: true
      } => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'password'),
        database: configService.get<string>('DB_NAME', 'concorsi_db'),
        entities: [Concorso, Vincita],
        synchronize: true,
      }),
    }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): { connection: { host: string; port: number } } => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),

    LogModule,
    NotificationModule,
    ConcorsiModule,
    VinciteModule,
    CrawlerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
