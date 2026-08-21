import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SessionTrack, SessionStatus } from '../entities/session.entity';

export class CreateSessionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  description: string;

  @ApiProperty({
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Max(2)
  day: number;

  @ApiProperty({ example: '2026-09-08T08:00:00+01:00' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: '2026-09-08T08:00:00+01:00' })
  @IsDateString()
  endsAt: string;

  @ApiProperty()
  @IsString()
  @MaxLength(255)
  room: string;

  @ApiProperty({
    enum: SessionTrack,
  })
  @IsEnum(SessionTrack)
  track: SessionTrack;

  @ApiProperty({
    example: 'Breakout Session',
  })
  @IsString()
  @MaxLength(255)
  type: string;

  @ApiPropertyOptional()
  @IsOptional()
  audience?: string;

  @ApiPropertyOptional({
    type: [String],
  })
  @IsOptional()
  speakerIds?: string[];

  @ApiPropertyOptional({ enum: SessionStatus, default: SessionStatus.SCHEDULED })
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
