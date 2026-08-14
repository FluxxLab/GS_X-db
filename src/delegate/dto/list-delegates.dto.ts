import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AccessTier } from '../entities/delegate.entity';

export class ListDelegatesDto {
    @ApiPropertyOptional({ description: 'Matches name, email, organisation' })
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional({ enum: AccessTier })
    @IsOptional()
    @IsEnum(AccessTier)
    tier?: AccessTier;

    @ApiPropertyOptional({ description: 'Thematic track slug' })
    @IsOptional()
    @IsString()
    track?: string;
}
