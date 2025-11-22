import {IsDate, IsNotEmpty, IsString, IsUrl} from 'class-validator';
import {Type} from 'class-transformer';

export class CrawlVincitaDto {
    @IsString() @IsNotEmpty() sourceId: string;
    @IsString() @IsNotEmpty() title: string;
    @IsString() @IsNotEmpty() brand: string;
    @IsUrl() source: string;

    @Type((): DateConstructor => Date)
    @IsDate()
    wonAt: Date;
}