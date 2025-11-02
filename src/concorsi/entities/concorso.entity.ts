import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Type } from 'class-transformer'; // <-- 1. IMPORT

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
  @Type(() => Date) // <-- 2. ADD DECORATOR
  startDate: Date;

  @Column({ type: 'date' })
  @Type(() => Date) // <-- 3. ADD DECORATOR
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
  @Type(() => Date) // <-- 4. ADD DECORATOR
  crawledAt: Date;

  @CreateDateColumn()
  @Type(() => Date) // <-- 5. ADD DECORATOR
  createdAt: Date;

  @UpdateDateColumn()
  @Type(() => Date) // <-- 6. ADD DECORATOR
  updatedAt: Date;
}