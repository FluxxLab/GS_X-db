import { PartialType } from '@nestjs/swagger';
import { CreateTriviaQuestionDto } from './create-trivia.dto';

export class UpdateTriviaQuestionDto extends PartialType(
  CreateTriviaQuestionDto,
) {}
