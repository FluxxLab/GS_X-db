import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({
    description: 'The comment body',
    example: 'This is a comment',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;
}
