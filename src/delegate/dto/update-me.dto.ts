import {
  IsOptional,
  IsString,
  IsArray,
  ArrayMaxSize,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMeDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Array of delegate IDs to update',
  })
  /**
   * ArrayMaxSize takes no `each` - with it, the size check runs against every
   * *element*, and a string is never an array, so any non-empty tracks or
   * interests failed validation outright. That is why onboarding could not
   * save: the 400 fired before the handler ever ran. Element length gets its
   * own each-constraint instead.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @ArrayMaxSize(50)
  tracks?: string[];

  @ApiPropertyOptional({ type: [String], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @ArrayMaxSize(5)
  interests?: string[];

  @ApiPropertyOptional({
    description:
      'Object key from POST /delegates/me/avatar-upload, saved once the PUT to S3 succeeds. A full URL is also accepted, for an externally hosted avatar.',
    example: 'delegate-avatars/6f1c0f6e-2d1a-4a1e-9a0e-2c7f3f0f9b21',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  /**
   * Was @IsUrl(), which rejected the key the upload flow now returns - the
   * PATCH 400d, so the photo reached S3 and the column stayed null.
   *
   * The prefix is pinned deliberately: without it a delegate could point their
   * avatar at any object in the bucket, including someone else's upload.
   */
  @Matches(/^(https?:\/\/\S+|delegate-avatars\/[A-Za-z0-9._-]+)$/, {
    message:
      'avatarUrl must be a delegate-avatars/... key from /delegates/me/avatar-upload, or an http(s) URL',
  })
  avatarUrl?: string;
}
