import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../auth/strategies/jwt.stategies';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { AnswerTriviaDto } from './dto/answer-trivia.dto';
import { CreateTriviaQuestionDto } from './dto/create-trivia.dto';
import { UpdateTriviaQuestionDto } from './dto/update-trivia.dto';
import { TriviaService } from './trivia.service';
import { Audit } from 'src/common/decorators/audit.decorator';

@ApiTags('Trivia')
@ApiBearerAuth()
@Controller('trivia')
export class TriviaController {
  constructor(private readonly service: TriviaService) {}

  @Public()
  @Get('current')
  @ApiOperation({
    summary: '',
  })
  current() {
    return this.service.currentQuestion();
  }

  @Get('history')
  @ApiOperation({
    summary:
      "A delegate's own closed questions, with their answer and the reveal",
  })
  @ApiResponse({ status: 200, description: 'Closed questions, newest first' })
  history(@CurrentUser() user: AuthUser) {
    return this.service.historyFor(user.id);
  }

  @Post(':id/answer')
  @HttpCode(200)
  @ApiOperation({})
  answer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnswerTriviaDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.answer(user.id, id, dto);
  }

  @Get()
  @Roles(AccessTier.ADMIN)
  @ApiOperation({})
  listAll() {
    return this.service.listAll();
  }
  @Post()
  @Roles(AccessTier.ADMIN)
  @ApiOperation({})
  create(@Body() dto: CreateTriviaQuestionDto) {
    return this.service.create(dto);
  }

  @Patch(':id/close')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({
    summary: '',
  })
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.close(id);
  }

  @Patch(':id/live')
  @Roles(AccessTier.ADMIN)
  @Audit({ type: 'trivia_live', description: 'Trivia pushed to live' })
  @ApiOperation({
    summary: '',
  })
  pushLive(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.pushLive(id);
  }

  // Declared after ':id/close' and ':id/live' so those keep matching first.
  @Patch(':id')
  @Roles(AccessTier.ADMIN)
  @Audit({ type: 'trivia_updated', description: 'Trivia question edited' })
  @ApiOperation({
    summary: 'Edit a question (a live one is re-sent to delegates)',
  })
  @ApiResponse({ status: 404, description: 'No such question' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTriviaQuestionDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(AccessTier.ADMIN)
  @Audit({ type: 'trivia_deleted', description: 'Trivia question deleted' })
  @ApiOperation({
    summary: 'Delete a question along with every answer given to it',
  })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'No such question' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.service.remove(id);
  }

  @Get(':id/stats')
  @Roles(AccessTier.ADMIN)
  stats(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.stats(id);
  }
}
