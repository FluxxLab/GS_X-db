import { Transform } from 'class-transformer';
import { normalisePhone } from 'src/common/phone';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Public } from 'src/common/decorators/public.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

@Public()
export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
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
    description: '6 digit code from the verification email/sms',
  })
  @IsString()
  @Length(6, 6)
  otp: string;

  @ApiPropertyOptional({ example: '08012345678 or +2349030000000' })
  @IsString()
  @IsOptional()
  // stored in E.164 whichever way the delegate wrote it - see common/phone.ts
  @Transform(({ value }) =>
    typeof value === 'string' ? normalisePhone(value) : value,
  )
  phone?: string;

  @ApiProperty({
    description:
      'Consent to registration terms — must be explicitly true (boolean)',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  consent: boolean;
}
