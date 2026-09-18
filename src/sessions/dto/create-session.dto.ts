import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { SessionTrack, SessionStatus } from '../entities/session.entity';

/** ISO 8601 with an explicit zone: a trailing `Z` or `±HH:MM`. */
const TZ_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;

export class CreateSessionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Max(2)
  day: number;

  /**
   * The offset is mandatory. `new Date('2026-09-08T09:00:00')` is read in
   * whatever zone the process runs in - UTC in the container, the operator's
   * laptop in a browser - so an offset-less string stores a different instant
   * depending on who parsed it. Rejecting it here turns a silent one-hour
   * drift into a 400 the client sees.
   */
  @ApiProperty({ example: '2026-09-08T08:00:00+01:00' })
  @IsDateString()
  @Matches(TZ_OFFSET, {
    message: 'startsAt must carry a timezone offset, e.g. +01:00',
  })
  startsAt: string;

  @ApiProperty({ example: '2026-09-08T08:00:00+01:00' })
  @IsDateString()
  @Matches(TZ_OFFSET, {
    message: 'endsAt must carry a timezone offset, e.g. +01:00',
  })
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

  /**
   * Validated as a URL rather than a YouTube id so the field survives a
   * change of video platform. Empty string is accepted and stored as null,
   * because that is what an operator clearing the box actually sends.
   */
  @ApiPropertyOptional({
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    description: 'Link to the session recording or live stream',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '' && value !== null)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  videoUrl?: string;

  @ApiPropertyOptional({
    type: [String],
  })
  @IsOptional()
  speakerIds?: string[];

  @ApiPropertyOptional({
    enum: SessionStatus,
    default: SessionStatus.SCHEDULED,
  })
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;
}
