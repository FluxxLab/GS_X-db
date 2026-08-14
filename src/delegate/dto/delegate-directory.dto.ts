import { ApiProperty } from '@nestjs/swagger';
import { AccessTier } from '../entities/delegate.entity';

export class DelegateDirectoryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Fatima Bello' })
  name: string;

  @ApiProperty({ example: 'African Development Bank', nullable: true })
  organisation: string | null;

  @ApiProperty({ example: 'Nigeria', nullable: true })
  country: string | null;

  @ApiProperty({ enum: AccessTier, example: AccessTier.STANDARD })
  accessTier: AccessTier;

  @ApiProperty({ example: 'Climate Policy Advisor', nullable: true })
  title: string | null;

  @ApiProperty({ example: 'energy', nullable: true })
  track: string | null;

  @ApiProperty({ type: [String], example: ['keynote', 'roundtable-a'] })
  tags: string[];

  @ApiProperty({ type: [String], example: ['energy', 'food-systems'] })
  tracks: string[];
}
