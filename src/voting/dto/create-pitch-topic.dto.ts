import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';

@ApiTags('Pitch Topics')
export class CreatePitchTopicDto {
  @ApiProperty({ description: 'Topic name as announced in the run-of-show' })
  @IsString()
  @MaxLength(160)
  name: string;

  @ApiPropertyOptional({ description: 'Presentation order, lowest first' })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
