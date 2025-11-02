import { Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { CrawlerService } from './crawler.service';
import { CrawlerController } from './crawler.controller';
import { ConcorsiModule } from '../concorsi/concorsi.module';
import { DimmiCosaCerchiStrategy } from './strategies/dimmi-cosa-cerchi-strategy.service';
import { BullModule } from '@nestjs/bullmq';
import { ScanWorker } from './scan.worker';
import { SummaryWorker } from './summary.worker'; // Importa il nuovo worker
import { FlowProducer } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  SCAN_QUEUE_NAME,
  DETAIL_QUEUE_NAME,
  SUMMARY_QUEUE_NAME,
  FLOW_PRODUCER
} from './crawler.constants';
import { DetailWorker } from './detail.worker'; // Importa dal nuovo file

// Provider per il FlowProducer
const flowProducerProvider = {
  provide: FLOW_PRODUCER, // Usa la costante
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
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
    BullModule.registerQueue(
      { name: SCAN_QUEUE_NAME },
      { name: DETAIL_QUEUE_NAME },
      { name: SUMMARY_QUEUE_NAME }, // Registra la nuova coda
    ),
    // LogModule e NotificationModule sono globali
  ],
  providers: [
    CrawlerService,
    ScanWorker,
    DetailWorker,
    SummaryWorker, // Aggiunge il nuovo worker
    DimmiCosaCerchiStrategy,
    flowProducerProvider, // Aggiunge il FlowProducer
  ],
  controllers: [CrawlerController],
})
export class CrawlerModule implements OnModuleDestroy {
  // Iniettiamo il FlowProducer per poterlo chiudere
  constructor(
    @Inject(FLOW_PRODUCER) private readonly flowProducer: FlowProducer,
  ) {}

  // Chiudiamo le connessioni OnDestroy
  onModuleDestroy() {
    this.flowProducer.close();
  }
}
