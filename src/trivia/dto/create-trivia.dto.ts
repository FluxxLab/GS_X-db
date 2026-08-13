import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TriviaOption } from '../entities/trivia-question.entity';


export class CreateTriviaQuestionDto {
    @ApiProperty({
        description: 'The text of the trivia questions'
    })
    @IsString()
    text: string;

    @ApiProperty({
        description: 'option'
    })
    @IsString()
    optionA: string;

    @ApiProperty({
        description: 'option'
    })
    @IsString()
    optionB: string;

    @ApiProperty({
        description: 'option'
    })
    @IsString()
    optionC: string;

    @ApiProperty({
        description: 'option'
    })
    @IsString()
    optionD: string;

    @ApiProperty({
        enum: TriviaOption
    })
    @IsEnum(TriviaOption)
    correctOption: TriviaOption;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    explanation?: string;


}
