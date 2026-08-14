import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class setOverlaysDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  caption?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  signLanguage?: boolean;
}
