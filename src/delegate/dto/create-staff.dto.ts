import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AccessTier } from '../entities/delegate.entity';

/**
 * A staff login created by an admin, straight into its role. Staff are not
 * delegates: nobody on the capture desk should have to register in the app,
 * wait for a code and then be promoted before they can sit down.
 */
export class CreateStaffDto {
  @ApiProperty({ example: 'Amaka Obi' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'amaka@policycentre.org' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'At least 8 characters; they can change it later',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({
    enum: [AccessTier.ADMIN, AccessTier.SESSION_ADMIN],
    description:
      "'admin' for the whole console, 'session_admin' for the Capture tab only",
  })
  @IsIn([AccessTier.ADMIN, AccessTier.SESSION_ADMIN])
  role: AccessTier.ADMIN | AccessTier.SESSION_ADMIN;
}
