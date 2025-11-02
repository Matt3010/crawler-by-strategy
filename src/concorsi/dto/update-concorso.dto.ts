import { PartialType } from '@nestjs/swagger';
import { CreateConcorsoDto } from './create-concorso.dto';
export class UpdateConcorsoDto extends PartialType(CreateConcorsoDto) {}
