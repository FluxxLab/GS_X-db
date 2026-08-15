import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendDirectMessageDto {
  @ApiProperty({
    description: 'Message body text',
    example: 'Hi Fatima! See you at the GBV roundtable at 4pm?',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(2000)
  body: string;
}
