import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsPhoneNumber, ValidateIf } from 'class-validator';

export class RequestOtpDto {
    @ApiProperty()
    @IsEmail()
    email: string;

    @ApiProperty({enum: ['email', 'sms'], description: 'where to send the code -delegates code'})
    @IsIn(['email', 'sms'])
    channel: 'email' | 'sms';

    @ApiPropertyOptional({example: '+2349035374708', description: 'required when channel is sms '})
    @ValidateIf((o) => o.channel === 'sms')
    @IsPhoneNumber()
    phone?: string;
}