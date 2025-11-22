import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Concorso } from './entities/concorso.entity';
import { CrawlConcorsoDto } from './dto/crawl-concorso.dto';
import {ActivitySyncClient, SyncResult} from "../../common/activities/activity-sync.client";

@Injectable()
export class ConcorsiService {
    constructor(
        @InjectRepository(Concorso)
        private readonly concorsiRepository: Repository<Concorso>,
        private readonly syncClient: ActivitySyncClient
    ) {}

    public async findAllPublic(): Promise<Concorso[]> {
        const query: SelectQueryBuilder<Concorso> =
            this.concorsiRepository.createQueryBuilder('concorso');

        query.orderBy('concorso.startDate', 'DESC');

        return query.getMany();
    }

    public async createOrUpdateFromCrawl(
        dto: CrawlConcorsoDto,
    ): Promise<SyncResult<Concorso>> {
        return this.syncClient.syncEntity<Concorso, CrawlConcorsoDto>(
            this.concorsiRepository,
            dto,
            'Concorso',
            {
                hasChanged: (entity: Concorso, dto: CrawlConcorsoDto): boolean => this.hasDataChanged(entity, dto),

                mapDtoToEntity: (dto: CrawlConcorsoDto, entity: Concorso): Concorso => ({
                    ...entity,
                    title: dto.title,
                    brand: dto.brand,
                    description: dto.description,
                    startDate: dto.startDate,
                    rulesUrl: dto.rulesUrl,
                    images: dto.images,
                    source: dto.source,
                    sourceId: dto.sourceId,
                    crawledAt: new Date()
                })
            }
        );
    }

    private hasDataChanged(entity: Concorso, dto: CrawlConcorsoDto): boolean {
        const newDesc: string = dto.description ?? entity.description;

        if (entity.title !== dto.title) return true;
        if (entity.brand !== dto.brand) return true;
        if (entity.description !== newDesc) return true;
        if (entity.rulesUrl !== dto.rulesUrl) return true;

        const entityStart: number = entity.startDate ? new Date(entity.startDate).getTime() : null;
        const dtoStart: number = dto.startDate ? new Date(dto.startDate).getTime() : null;
        if (entityStart !== dtoStart) return true;

        const oldImages: string = JSON.stringify(entity.images || []);
        const newImages: string = JSON.stringify(dto.images || []);
        return oldImages !== newImages;
    }
}