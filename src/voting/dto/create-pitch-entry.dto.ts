import { IsString, MaxLength, IsEnum } from 'class-validator';
import { ApiTags, ApiProperty } from '@nestjs/swagger';
import { SessionTrack } from 'src/sessions/entities/session.entity';

@ApiTags('Pitch Entries')
export class CreatePitchEntryDto {
  @ApiProperty({
    description: 'The name of the innovator',
  })
  @IsString()
  @MaxLength(255)
  innovatorName: string;

  @ApiProperty({
    description: 'Country of the innovator',
  })
  @IsString()
  country: string;

  @ApiProperty({
    description: 'keep track of the Session',
  })
  @IsEnum(SessionTrack)
  track: SessionTrack;

  @ApiProperty({
    description: 'Description of the pitch',
  })
  @IsString()
  description: string;
}
