import {Controller, Get} from '@nestjs/common';
import {ConcorsiService} from './concorsi.service';
import {ApiOperation, ApiQuery, ApiTags} from '@nestjs/swagger';
import {Concorso} from "./entities/concorso.entity";

@ApiTags('Concorsi')
@Controller('concorsi')
export class ConcorsiController {
  constructor(private readonly concorsiService: ConcorsiService) {}

  @Get()
  @ApiOperation({ summary: 'Lista pubblica concorsi (solo attivi)' })
  @ApiQuery({required: false, description: 'Filtra per brand' })
  findAllPublic(): Promise<Concorso[]> {
    return this.concorsiService.findAllPublic();
  }
}
