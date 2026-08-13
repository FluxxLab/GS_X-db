import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { EventSeverity } from '../entities/security-event.entity';

export class QueryEventsDto {
    @ApiPropertyOptional({enum: EventSeverity})
    @IsOptional()
    @IsEnum(EventSeverity)
    severity?: EventSeverity;

    @ApiPropertyOptional({description: 'Cursor: return events created before this ISO timestamp'})
    @IsOptional()
    @IsDateString()
    before?: string;

    @ApiPropertyOptional({default: 50, maximum: 100})
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;

}