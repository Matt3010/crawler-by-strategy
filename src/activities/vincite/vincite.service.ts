import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vincita } from './entities/vincita.entity';
import { CrawlVincitaDto } from './dto/crawl-vincita.dto';
import {ActivitySyncClient, SyncResult} from "../../common/activities/activity-sync.client";

@Injectable()
export class VinciteService {
    constructor(
        @InjectRepository(Vincita)
        private readonly vinciteRepository: Repository<Vincita>,
        private readonly syncClient: ActivitySyncClient
    ) {}

    public async createOrUpdateFromCrawl(
        dto: CrawlVincitaDto,
    ): Promise<SyncResult<Vincita>> {
        return this.syncClient.syncEntity<Vincita, CrawlVincitaDto>(
            this.vinciteRepository,
            dto,
            'Vincita',
            {
                hasChanged: (entity: Vincita, dto: CrawlVincitaDto): boolean => {
                    if (entity.title !== dto.title) return true;
                },

                mapDtoToEntity: (dto: CrawlVincitaDto, entity: Vincita): Vincita => ({
                    ...entity,
                    sourceId: dto.sourceId,
                    title: dto.title,
                    brand: dto.brand,
                    source: dto.source,
                    wonAt: dto.wonAt,
                })
            }
        );
    }

    public async findAll(): Promise<Vincita[]> {
        return this.vinciteRepository.find({
            order: { wonAt: 'DESC' },
            take: 50
        });
    }
}