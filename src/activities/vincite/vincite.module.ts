import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VinciteService } from './vincite.service';
import { Vincita } from './entities/vincita.entity';
import { SoldissimiVinciteStrategy } from './strategies/soldissimi-vincite.strategy';
import { ConfigModule } from '@nestjs/config';
import { VinciteController } from './vincite.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([Vincita]),
        ConfigModule
    ],
    controllers: [VinciteController],
    providers: [
        VinciteService,
        SoldissimiVinciteStrategy
    ],
    exports: [VinciteService, SoldissimiVinciteStrategy],
})
export class VinciteModule {}