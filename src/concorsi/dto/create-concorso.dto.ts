import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUrl, IsOptional, IsArray, IsDate } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateConcorsoDto {
  @ApiProperty({ example: 'Vinci la spesa 2025' })
  @IsString() @IsNotEmpty() title: string;

  @ApiProperty({ example: 'Brand Famoso' })
  @IsString() @IsNotEmpty() brand: string;

  @ApiProperty({ example: 'Descrizione del concorso...' })
  @IsString() @IsNotEmpty() description: string;

  @ApiProperty({ example: '2025-01-01' })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiProperty({ example: '2025-02-01' })
  @Type(() => Date)
  @IsDate()
  endDate: Date;

  @ApiProperty({ example: 'https://sito.com/regolamento.pdf' })
  @IsUrl() rulesUrl: string;

  @ApiPropertyOptional({ type: [String], example: ['img1.jpg', 'img2.jpg'] })
  @IsArray() @IsString({ each: true }) @IsOptional() images?: string[];
}
