import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';
import { Type } from 'class-transformer';

@Entity('vincite')
export class Vincita {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    title: string;

    @Column({ type: 'varchar', length: 100, nullable: true })
    winnerName: string;

    @Column({ type: 'text', nullable: true })
    content: string;

    @Column({ type: 'timestamp' })
    @Type((): DateConstructor => Date)
    wonAt: Date;

    @Column({ type: 'varchar', length: 500 })
    source: string;

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 255 })
    sourceId: string;

    @Column({ type: 'varchar', length: 50 })
    brand: string;

    @Column({ type: 'int', default: 0 })
    views: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}