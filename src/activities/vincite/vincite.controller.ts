import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VinciteService } from './vincite.service';
import { Vincita } from './entities/vincita.entity';

@ApiTags('Vincite')
@Controller('vincite')
export class VinciteController {
    constructor(private readonly vinciteService: VinciteService) {}

    @Get()
    @ApiOperation({ summary: 'Lista ultime vincite' })
    findAll(): Promise<Vincita[]> {
        return this.vinciteService.findAll();
    }
}