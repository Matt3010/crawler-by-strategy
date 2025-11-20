import { IsString, IsNotEmpty, IsUrl, IsOptional, IsDate, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class CrawlConcorsoDto {
  @IsString() @IsNotEmpty() sourceId: string;
  @IsString() @IsNotEmpty() title: string;
  @IsString() @IsNotEmpty() brand: string;
  @IsUrl() rulesUrl: string;
  @IsUrl() source: string;
  @IsString() @IsOptional() description?: string;

  @Type((): DateConstructor => Date)
  @IsDate()
  startDate: Date;

  @Type((): DateConstructor => Date)
  @IsDate()
  @IsOptional()
  endDate: Date | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  images?: string[];
}
