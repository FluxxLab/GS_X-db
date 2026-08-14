import {Controller, Get, Post, Patch, Param, ParseUUIDPipe,Query, Logger, Body, Res} from '@nestjs/common';
import {ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse} from '@nestjs/swagger';
import {DiscussionService} from './discussions.service';
import {CreateCommentDto} from './dto/create-comment.dto';
import {QueryCommentsDto} from './dto/query-comments.dto';
import {SessionComment} from './entities/session-comment.entity';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { AuthUser } from 'src/auth/strategies/jwt.stategies';
import { Roles } from 'src/common/decorators/roles.decorator';
import { AccessTier } from 'src/delegate/entities/delegate.entity';
import { Audit } from 'src/common/decorators/audit.decorator';
import type {Response} from 'express';
import { EventSeverity } from 'src/security/entities/security-event.entity';





@ApiTags('discussions')
@ApiBearerAuth()
@Controller('discussions')
export class DiscussionsController{
    private readonly logger = new Logger(DiscussionsController.name);
    constructor(
        private readonly service: DiscussionService,
        

    ){}

    @Post('sessions/:sessionId')
    @ApiOperation({summary: 'Create a new comment for a session'})
    @ApiResponse({status: 201, description: 'Comment created successfully'})
    @ApiParam({name: 'sessionId', description: 'Session ID', type: String})
    async createComment(@Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() dto: CreateCommentDto, @CurrentUser() user: AuthUser){
        return this.service.postComment(sessionId, user.id, dto);
    }


    @Get('sessions/:sessionId/comments')
    @ApiOperation({summary: 'Get all comments for a session'})
    @ApiParam({name: 'sessionId', description: 'Session ID', type: String})
    async getComments(@Param('sessionId', ParseUUIDPipe) sessionId: string, @Query() query: QueryCommentsDto){
        return this.service.listComments(sessionId, query);
    }

    @Post('comments/:id/flag')
    @ApiOperation({summary: 'flag a comment'})
    @ApiResponse({status: 200, description: 'Comment flagged successfully'})
    @ApiParam({name: 'id', description: 'Comment ID', type: String})
    async flagComment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser){
        return this.service.flagComment(id, user.id);
    }

    @Patch('comments/:id/hide')
    @Roles(AccessTier.ADMIN)
    @ApiOperation({summary: 'hide a comment'})
    @Audit({type: 'comment_hidden', description: 'Comment hidden'})
    @ApiParam({name: 'id', description: 'Comment ID', type: String})
    @ApiResponse({status: 200, description: 'Comment hidden successfully'})
    async hideComment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser){
     return await this.service.hideComment(id, user.id);
    }

    @Patch('sessions/:sessionId/moderation')
    @Roles(AccessTier.ADMIN)
    @ApiOperation({summary: 'Moderate a session'})
    @ApiParam({name: 'sessionId', description: 'Session ID', type: String})
    @ApiResponse({status: 200, description: 'Session moderated successfully'})
    async moderateSession(@Param('sessionId', ParseUUIDPipe) sessionId: string,){
        return await this.service.listForModeration(sessionId);
    }

     @Get('sessions/:sessionId/comments/export')
    @Roles(AccessTier.ADMIN)
    @Audit({ type: 'thread_exported', description: 'Discussion thread exported', severity: EventSeverity.WARNING })
    @ApiOperation({ summary: 'Export a session thread as CSV or JSON (admin, audited)' })
    async exportComments(
        @Param('sessionId', ParseUUIDPipe) sessionId: string,
        @Query('format') format: string = 'csv',
        @Res() res: Response,
    ) {
        const comments = await this.service.listForModeration(sessionId);
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            return res.send(JSON.stringify(comments, null, 2));
        }
        const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const rows = [
            'createdAt,authorId,body,flagged,hidden',
            ...comments.map((c) =>
                [c.createdAt.toISOString(), c.authorId, cell(c.body), c.flagged, !!c.hiddenAt].join(','),
            ),
        ];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.send(rows.join('\n'));
    }

}

