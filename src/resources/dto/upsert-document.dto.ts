import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpsertDocumentDto {
  @ApiProperty({ example: 'The Purple Book 2026' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    description:
      'Public URL, typically the publicUrl from POST /documents/upload-url',
  })
  @IsUrl()
  @MaxLength(512)
  url: string;

  @ApiPropertyOptional({
    example: '4.2 MB',
    description: 'Shown next to the download button',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  sizeLabel?: string;
}
