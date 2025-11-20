import { IsString, IsNotEmpty, IsUrl, IsOptional, IsDate, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CrawlVincitaDto {
    @IsString() @IsNotEmpty() sourceId: string;
    @IsString() @IsNotEmpty() title: string;
    @IsString() @IsNotEmpty() brand: string;
    @IsUrl() source: string;

    @IsString()
    @IsOptional()
    winnerName?: string;

    @IsString()
    @IsOptional()
    content?: string;

    @Type((): DateConstructor => Date)
    @IsDate()
    wonAt: Date;

    @IsNumber()
    @IsOptional()
    views?: number;
}