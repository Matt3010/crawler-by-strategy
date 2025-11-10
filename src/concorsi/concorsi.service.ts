import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Concorso } from './entities/concorso.entity';
import { CrawlConcorsoDto } from './dto/crawl-concorso.dto';
export type CrawlStatus = 'created' | 'updated' | 'unchanged';

@Injectable()
export class ConcorsiService {
    private readonly logger: Logger = new Logger(ConcorsiService.name);
    constructor(
        @InjectRepository(Concorso)
        private readonly concorsiRepository: Repository<Concorso>,
    ) {}

    public async findAllPublic(): Promise<Concorso[]> {
        const today: string = new Date().toISOString().split('T')[0];
        const query: SelectQueryBuilder<Concorso> =
            this.concorsiRepository.createQueryBuilder('concorso');

        query.where('concorso.endDate >= :today', { today });

        query.orderBy('concorso.endDate', 'ASC');
        return query.getMany();
    }

    public async createOrUpdateFromCrawl(
        dto: CrawlConcorsoDto,
    ): Promise<{ concorso: Concorso; status: CrawlStatus }> {
        const existingConcorso: Concorso = await this.concorsiRepository.findOne({
            where: { sourceId: dto.sourceId },
        });
        const now = new Date();

        if (!existingConcorso) {
            return this.handleCreation(dto, now);
        }

        if (!this.hasDataChanged(existingConcorso, dto)) {
            return { concorso: existingConcorso, status: 'unchanged' };
        }

        return this.handleUpdate(existingConcorso, dto, now);
    }

    private async handleCreation(
        dto: CrawlConcorsoDto,
        now: Date,
    ): Promise<{ concorso: Concorso; status: 'created' }> {
        const newConcorso: Concorso = this.concorsiRepository.create({
            ...dto,
            crawledAt: now,
        });
        const created: Concorso = await this.concorsiRepository.save(newConcorso);
        return { concorso: created, status: 'created' };
    }

    private async handleUpdate(
        concorso: Concorso,
        dto: CrawlConcorsoDto,
        now: Date,
    ): Promise<{ concorso: Concorso; status: 'updated' }> {
        this.logger.log(`[${dto.sourceId}] Found changes. Updating.`);

        concorso.title = dto.title;
        concorso.brand = dto.brand;
        concorso.description = dto.description ?? concorso.description;
        concorso.startDate = dto.startDate;
        concorso.endDate = dto.endDate;
        concorso.rulesUrl = dto.rulesUrl;
        concorso.crawledAt = now;
        concorso.images = dto.images;

        const updated: Concorso = await this.concorsiRepository.save(concorso);
        return { concorso: updated, status: 'updated' };
    }

    private hasDataChanged(entity: Concorso, dto: CrawlConcorsoDto): boolean {
        const newDesc: string = dto.description ?? entity.description;

        if (entity.title !== dto.title) return true;
        if (entity.brand !== dto.brand) return true;
        if (entity.description !== newDesc) return true;
        if (entity.rulesUrl !== dto.rulesUrl) return true;

        if (entity.startDate.getTime() !== dto.startDate.getTime()) return true;
        if (entity.endDate.getTime() !== dto.endDate.getTime()) return true;

        const oldImages: string = JSON.stringify(entity.images || []);
        const newImages: string = JSON.stringify(dto.images || []);
        return oldImages !== newImages;
    }
}