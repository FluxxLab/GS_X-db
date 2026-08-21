import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SessionStatus, SessionTrack } from '../entities/session.entity';

export class QuerySessionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  day?: number;

  @ApiPropertyOptional({ enum: SessionTrack })
  @IsOptional()
  @IsEnum(SessionTrack)
  track?: SessionTrack;

  @ApiPropertyOptional({ enum: SessionStatus })
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
