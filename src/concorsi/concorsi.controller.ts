import { Controller, Get, Post, Body, Param, Delete, Put, Query, ParseUUIDPipe } from '@nestjs/common';
import { ConcorsiService } from './concorsi.service';
import { CreateConcorsoDto } from './dto/create-concorso.dto';
import { UpdateConcorsoDto } from './dto/update-concorso.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import {Concorso} from "./entities/concorso.entity";

@ApiTags('Concorsi')
@Controller('concorsi')
export class ConcorsiController {
  constructor(private readonly concorsiService: ConcorsiService) {}

  @Get()
  @ApiOperation({ summary: 'Lista pubblica concorsi (solo attivi)' })
  @ApiQuery({ name: 'brand', required: false, description: 'Filtra per brand' })
  findAllPublic(@Query('brand') brand?: string): Promise<Concorso[]> {
    return this.concorsiService.findAllPublic(brand);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Dettaglio concorso pubblico' })
  findOnePublic(@Param('id', ParseUUIDPipe) id: string): Promise<Concorso> {
    return this.concorsiService.findOnePublic(id);
  }
  @Post()
  @ApiOperation({ summary: 'Crea un concorso' })
  create(@Body() createConcorsoDto: CreateConcorsoDto): Promise<Concorso> {
    return this.concorsiService.create(createConcorsoDto);
  }
  @Put(':id')
  @ApiOperation({ summary: 'Aggiorna un concorso' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateConcorsoDto: UpdateConcorsoDto): Promise<Concorso> {
    return this.concorsiService.update(id, updateConcorsoDto);
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Elimina un concorso' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.concorsiService.remove(id);
  }
}
