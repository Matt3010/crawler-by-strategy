import { Controller, Get, Post, Body, Param, Delete, Put, Query, ParseUUIDPipe } from '@nestjs/common';
import { ConcorsiService } from './concorsi.service';
import { CreateConcorsoDto } from './dto/create-concorso.dto';
import { UpdateConcorsoDto } from './dto/update-concorso.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiTags('Concorsi')
@Controller('concorsi')
export class ConcorsiController {
  constructor(private readonly concorsiService: ConcorsiService) {}

  @Get()
  @ApiOperation({ summary: 'Lista pubblica concorsi (solo attivi)' })
  @ApiQuery({ name: 'brand', required: false, description: 'Filtra per brand' })
  findAllPublic(@Query('brand') brand?: string) {
    return this.concorsiService.findAllPublic(brand);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Dettaglio concorso pubblico' })
  findOnePublic(@Param('id', ParseUUIDPipe) id: string) {
    return this.concorsiService.findOnePublic(id);
  }
  @Post()
  @ApiOperation({ summary: 'Crea un concorso' })
  create(@Body() createConcorsoDto: CreateConcorsoDto) {
    return this.concorsiService.create(createConcorsoDto);
  }
  @Put(':id')
  @ApiOperation({ summary: 'Aggiorna un concorso' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateConcorsoDto: UpdateConcorsoDto) {
    return this.concorsiService.update(id, updateConcorsoDto);
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Elimina un concorso' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.concorsiService.remove(id);
  }
}
