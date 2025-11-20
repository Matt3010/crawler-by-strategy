import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vincita } from './entities/vincita.entity';
import { CrawlVincitaDto } from './dto/crawl-vincita.dto';

export type CrawlStatus = 'created' | 'updated' | 'unchanged';

@Injectable()
export class VinciteService {
    private readonly logger: Logger = new Logger(VinciteService.name);

    constructor(
        @InjectRepository(Vincita)
        private readonly vinciteRepository: Repository<Vincita>,
    ) {}

    public async createOrUpdateFromCrawl(
        dto: CrawlVincitaDto,
    ): Promise<{ vincita: Vincita; status: CrawlStatus }> {
        const existing: Vincita = await this.vinciteRepository.findOne({
            where: { sourceId: dto.sourceId },
        });

        if (!existing) {
            this.logger.log(`[${dto.sourceId}] Creating new vincita: ${dto.title}`);
            const newEntity = this.vinciteRepository.create(dto);
            const saved = await this.vinciteRepository.save(newEntity);
            return { vincita: saved, status: 'created' };
        }

        if (existing.title !== dto.title) {
            this.logger.log(`[${dto.sourceId}] Found changes. Updating.`);
            existing.title = dto.title;
            existing.content = dto.content ?? existing.content;

            const updated = await this.vinciteRepository.save(existing);
            return { vincita: updated, status: 'updated' };
        }

        return { vincita: existing, status: 'unchanged' };
    }

    public async findAll(): Promise<Vincita[]> {
        return this.vinciteRepository.find({
            order: { wonAt: 'DESC' },
            take: 50
        });
    }
}