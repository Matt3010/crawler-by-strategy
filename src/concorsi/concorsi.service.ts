import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {DeleteResult, Repository, SelectQueryBuilder} from 'typeorm';
import { Concorso } from './entities/concorso.entity';
import { CreateConcorsoDto } from './dto/create-concorso.dto';
import { UpdateConcorsoDto } from './dto/update-concorso.dto';
import { CrawlConcorsoDto } from './dto/crawl-concorso.dto';

export type CrawlStatus = 'created' | 'updated' | 'unchanged';

@Injectable()
export class ConcorsiService {
  private readonly logger: Logger = new Logger(ConcorsiService.name);
  constructor(
    @InjectRepository(Concorso)
    private concorsiRepository: Repository<Concorso>,
  ) {}

  async create(createConcorsoDto: CreateConcorsoDto): Promise<Concorso> {
    const newConcorso: Concorso = this.concorsiRepository.create(createConcorsoDto);
    (newConcorso as any).source = 'manuale';
    (newConcorso as any).crawledAt = new Date();
    return this.concorsiRepository.save(newConcorso);
  }

  async update(id: string, updateConcorsoDto: UpdateConcorsoDto): Promise<Concorso> {
    const concorso: Concorso = await this.concorsiRepository.preload({ id: id, ...updateConcorsoDto });
    if (!concorso) {
      throw new NotFoundException(`Concorso con ID ${id} non trovato`);
    }
    return this.concorsiRepository.save(concorso);
  }

  async remove(id: string): Promise<void> {
    const result: DeleteResult = await this.concorsiRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Concorso con ID ${id} non trovato`);
    }
  }

  async findAllPublic(brand?: string): Promise<Concorso[]> {
    const today: string = new Date().toISOString().split('T')[0];
    const query: SelectQueryBuilder<Concorso> = this.concorsiRepository.createQueryBuilder('concorso');
    query.where('concorso.endDate >= :today', { today });
    if (brand) {
      query.andWhere('LOWER(concorso.brand) LIKE LOWER(:brand)', { brand: `%${brand}%` });
    }
    query.orderBy('concorso.endDate', 'ASC');
    return query.getMany();
  }

  async findOnePublic(id: string): Promise<Concorso> {
    const concorso: Concorso = await this.concorsiRepository.findOneBy({ id });
    if (!concorso) {
      throw new NotFoundException(`Concorso con ID ${id} non trovato`);
    }
    return concorso;
  }

  async createOrUpdateFromCrawl(dto: CrawlConcorsoDto): Promise<{ concorso: Concorso, status: CrawlStatus }> {
    const existingConcorso: Concorso = await this.concorsiRepository.findOne({
      where: { sourceId: dto.sourceId },
    });
    const now = new Date();

    if (existingConcorso) {
      let hasChanges: boolean = false;
      const desc = dto.description || existingConcorso.description;

      if (existingConcorso.title !== dto.title) hasChanges = true;
      if (existingConcorso.description !== desc) hasChanges = true;
      if (existingConcorso.rulesUrl !== dto.rulesUrl) hasChanges = true;

      if (existingConcorso.startDate.toISOString() !== dto.startDate.toISOString()) hasChanges = true;
      if (existingConcorso.endDate.toISOString() !== dto.endDate.toISOString()) hasChanges = true;

      const oldImages: string = JSON.stringify(existingConcorso.images || []);
      const newImages: string = JSON.stringify(dto.images || []);
      if (oldImages !== newImages) hasChanges = true;

      if (!hasChanges) {
        return { concorso: existingConcorso, status: 'unchanged' };
      }

      this.logger.log(`[${dto.sourceId}] Trovate modifiche. Aggiorno.`);

      existingConcorso.title = dto.title;
      existingConcorso.brand = dto.brand;
      existingConcorso.description = desc;
      existingConcorso.startDate = dto.startDate;
      existingConcorso.endDate = dto.endDate;
      existingConcorso.rulesUrl = dto.rulesUrl;
      existingConcorso.crawledAt = now;
      existingConcorso.images = dto.images;

      const updated: Concorso = await this.concorsiRepository.save(existingConcorso);
      return { concorso: updated, status: 'updated' };

    } else {
      const newConcorso: Concorso = this.concorsiRepository.create({ ...dto, crawledAt: now });
      const created: Concorso = await this.concorsiRepository.save(newConcorso);
      return { concorso: created, status: 'created' };
    }
  }
}
