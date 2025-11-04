import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Type } from 'class-transformer';

@Entity('concorsi')
export class Concorso {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 100 })
  brand: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'date' })
  @Type((): DateConstructor => Date)
  startDate: Date;

  @Column({ type: 'date' })
  @Type((): DateConstructor => Date)
  endDate: Date;

  @Column({ type: 'varchar', length: 500 })
  rulesUrl: string;

  @Column({ type: 'simple-array', nullable: true })
  images: string[];

  @Column({ type: 'varchar', length: 500 })
  source: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  sourceId: string | null;

  @Column({ type: 'timestamp', nullable: true })
  @Type((): DateConstructor => Date)
  crawledAt: Date;

  @CreateDateColumn()
  @Type((): DateConstructor  => Date)
  createdAt: Date;

  @UpdateDateColumn()
  @Type((): DateConstructor  => Date)
  updatedAt: Date;
}