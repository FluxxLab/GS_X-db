import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  /**
   * The message being replied to. Optional, and validated server-side against
   * the same thread - a reply must not be able to quote a message from a
   * conversation the sender is not part of.
   */
  @ApiPropertyOptional({
    description: 'Id of the message this one replies to',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  replyToId?: string;
}
