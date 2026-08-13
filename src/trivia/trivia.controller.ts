import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../auth/strategies/jwt.stategies';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { AnswerTriviaDto } from './dto/answer-trivia.dto';
import { CreateTriviaQuestionDto } from './dto/create-trivia.dto';
import { TriviaService } from './trivia.service';
import { Audit } from 'src/common/decorators/audit.decorator';

@ApiTags('Trivia')
@ApiBearerAuth()
@Controller('trivia')
export class TriviaController{
    constructor(
        private readonly service: TriviaService,
    ){}


    @Get('current')
    @ApiOperation({
        summary: ''
    })
    current(){
        return this.service.currentQuestion();
    }

    @Post(':id/answer')
    @HttpCode(200)
    @ApiOperation({

    })
    answer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerTriviaDto, @CurrentUser() user: AuthUser){
        return this.service.answer(user.id, id, dto);
    }

    @Get()
    @Roles(AccessTier.ADMIN)
    @ApiOperation({

    })
    listAll(){
        return this.service.listAll();
    }
    @Post()
    @Roles(AccessTier.ADMIN)
    @ApiOperation({

    })
    create(@Body() dto: CreateTriviaQuestionDto){
        return this.service.create(dto);
    }

    @Patch(':id/close')
    @Roles(AccessTier.ADMIN)
    @ApiOperation({
         summary: ''
    })
    close(@Param('id', ParseUUIDPipe) id: string){
        return this.service.close(id);
    }

    @Patch(':id/live')
    @Roles(AccessTier.ADMIN)
    @Audit({type: 'trivia_live', description: 'Trivia pushed to live'})
    @ApiOperation({
        summary: ''
    })
    pushLive(@Param('id', ParseUUIDPipe) id: string){
        return this.service.pushLive(id);
    }

    @Get(':id/stats')
    @Roles(AccessTier.ADMIN)
    stats(@Param('id', ParseUUIDPipe) id: string){
           return this.service.stats(id);
    }



}