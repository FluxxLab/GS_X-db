import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetAdminDto {
  @ApiProperty({ description: 'true grants admin access, false revokes it' })
  @IsBoolean()
  admin: boolean;
}
