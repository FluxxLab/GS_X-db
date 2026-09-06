import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { AccessTier } from './delegate.entity';

export type StaffRole = AccessTier.ADMIN | AccessTier.SESSION_ADMIN;

export class SetAdminDto {
  @ApiProperty({ description: 'true grants access, false revokes it' })
  @IsBoolean()
  admin: boolean;

  @ApiPropertyOptional({
    description:
      "Which access to grant: 'admin' (the whole console, default) or 'session_admin' (the Capture tab only). Ignored when revoking.",
    enum: [AccessTier.ADMIN, AccessTier.SESSION_ADMIN],
  })
  @IsOptional()
  @IsIn([AccessTier.ADMIN, AccessTier.SESSION_ADMIN])
  role?: StaffRole;
}
