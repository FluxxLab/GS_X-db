import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  Equals,
} from 'class-validator';
import { Public } from 'src/common/decorators/public.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@Public()
export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(12)
  @ApiProperty()
  password: string;

  @IsString()
  @ApiProperty()
  @MaxLength(255)
  name: string;

  @IsString()
  @ApiProperty()
  @IsOptional()
  @MaxLength(50)
  inviteCode?: string;

  @ApiProperty({
    description: ' 6 digit code from the verification email/sms ',
  })
  @IsString()
  @Length(6, 6)
  otp: string;

  @ApiPropertyOptional({ example: ' +2349030000000' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: '2025-10-15T12:00:00Z' })
  @Equals(true)
  consent: boolean;
}
