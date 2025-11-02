import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConcorsiService } from './concorsi.service';
import { ConcorsiController } from './concorsi.controller';
import { Concorso } from './entities/concorso.entity';

@Module({
  imports: [ TypeOrmModule.forFeature([Concorso]) ],
  controllers: [ConcorsiController],
  providers: [ConcorsiService],
  exports: [ConcorsiService, TypeOrmModule],
})
export class ConcorsiModule {}
