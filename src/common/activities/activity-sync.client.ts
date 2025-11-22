import { Injectable, Logger } from '@nestjs/common';
import { Repository, DeepPartial, ObjectLiteral } from 'typeorm';

export type SyncStatus = 'created' | 'updated' | 'unchanged';

export interface SyncResult<T> {
    entity: T;
    status: SyncStatus;
}

export interface IdentifiableEntity {
    sourceId: string | null;
    id?: string;
}

@Injectable()
export class ActivitySyncClient {
    private readonly logger: Logger = new Logger(ActivitySyncClient.name);

    public async syncEntity<T extends IdentifiableEntity & ObjectLiteral, Dto>(
        repository: Repository<T>,
        dto: Dto & { sourceId: string },
        entityName: string,
        options: {
            hasChanged: (entity: T, dto: Dto) => boolean;
            mapDtoToEntity: (dto: Dto, target?: T) => DeepPartial<T>;
        }
    ): Promise<SyncResult<T>> {
        const existing: T = await repository.findOne({
            where: { sourceId: dto.sourceId } as any
        });

        if (!existing) {
            this.logger.log(`[${dto.sourceId}] Creating new ${entityName}`);

            const newPayload: DeepPartial<T> = options.mapDtoToEntity(dto);
            const newEntity: T = repository.create(newPayload);
            const saved: T = await repository.save(newEntity);

            return { entity: saved, status: 'created' };
        }

        if (options.hasChanged(existing, dto)) {
            this.logger.log(`[${dto.sourceId}] Updating ${entityName}`);

            const updatePayload: DeepPartial<T> = options.mapDtoToEntity(dto, existing);
            const merged: T = repository.merge(existing, updatePayload);
            const updated: T = await repository.save(merged);

            return { entity: updated, status: 'updated' };
        }

        // 4. CASO NESSUN CAMBIAMENTO
        return { entity: existing, status: 'unchanged' };
    }
}