import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  ParseUUIDPipe,
  Query,
  Logger,
  Body,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { DiscussionService } from './discussions.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { QueryCommentsDto } from './dto/query-comments.dto';
import { VoteCommentDto } from './dto/vote-comment.dto';
import { QueryAllCommentsDto } from './dto/query-all-comments.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.stategies';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { Audit } from '../common/decorators/audit.decorator';
import type { Response } from 'express';
import { EventSeverity } from '../security/entities/security-event.entity';

@ApiTags('discussions')
@ApiBearerAuth()
@Controller('discussions')
export class DiscussionsController {
  private readonly logger = new Logger(DiscussionsController.name);
  constructor(private readonly service: DiscussionService) {}

  @Post('sessions/:sessionId')
  @ApiOperation({ summary: 'Create a new comment for a session' })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  @ApiParam({ name: 'sessionId', description: 'Session ID', type: String })
  async createComment(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.postComment(sessionId, user.id, dto);
  }

  @Get('sessions/:sessionId/comments')
  @ApiOperation({ summary: 'Get all comments for a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID', type: String })
  async getComments(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query() query: QueryCommentsDto,
    @CurrentUser() user: AuthUser,
  ) {
    // the viewer is passed so each row can carry that delegate's own vote
    return this.service.listComments(sessionId, query, user.id);
  }

  @Post('comments/:id/vote')
  @ApiOperation({ summary: 'Like, dislike, or clear a vote on a comment' })
  @ApiResponse({ status: 201, description: 'Updated counts and the new vote' })
  @ApiParam({ name: 'id', description: 'Comment ID', type: String })
  async voteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoteCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.vote(id, user.id, dto.value);
  }

  @Get('threads')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({
    summary: 'Forums: every session thread with its comment counts',
  })
  listThreads() {
    return this.service.listThreads();
  }

  @Get('comments')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({
    summary: 'Forums: every thread across all sessions, for moderation',
  })
  listAll(@Query() query: QueryAllCommentsDto) {
    return this.service.listAllComments(query);
  }

  @Post('comments/:id/flag')
  @ApiOperation({ summary: 'flag a comment' })
  @ApiResponse({ status: 200, description: 'Comment flagged successfully' })
  @ApiParam({ name: 'id', description: 'Comment ID', type: String })
  async flagComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.flagComment(id, user.id);
  }

  @Patch('comments/:id/hide')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'hide a comment' })
  @Audit({ type: 'comment_hidden', description: 'Comment hidden' })
  @ApiParam({ name: 'id', description: 'Comment ID', type: String })
  @ApiResponse({ status: 200, description: 'Comment hidden successfully' })
  async hideComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return await this.service.hideComment(id, user.id);
  }

  @Patch('sessions/:sessionId/moderation')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Moderate a session' })
  @ApiParam({ name: 'sessionId', description: 'Session ID', type: String })
  @ApiResponse({ status: 200, description: 'Session moderated successfully' })
  async moderateSession(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return await this.service.listForModeration(sessionId);
  }

  @Get('sessions/:sessionId/comments/export')
  @Roles(AccessTier.ADMIN)
  @Audit({
    type: 'thread_exported',
    description: 'Discussion thread exported',
    severity: EventSeverity.WARNING,
  })
  @ApiOperation({
    summary: 'Export a session thread as CSV or JSON (admin, audited)',
  })
  async exportComments(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query('format') format: string = 'csv',
    @Res() res: Response,
  ) {
    const comments = await this.service.exportThread(sessionId);
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(comments, null, 2));
    }

    /**
     * Every field is quoted, not just the body. Delegate names and
     * organisations routinely contain commas ("Dr. Osasuyi Dirisu, Executive
     * Director, PIC"), and one unquoted comma shifts every later column on
     * that row without any error to notice.
     */
    const cell = (v: string | number | boolean | null | undefined) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`;
    /** Semicolons inside one cell: a comma would need escaping the reader
     *  then has to undo, and Excel splits multi-value cells on neither. */
    const list = (v: string[]) => cell(v.join('; '));

    const rows = [
      // Left unquoted, unlike the data rows: a column name can never contain a
      // comma, and a quoted first header would swallow the leading BOM in
      // readers that do not strip it before parsing.
      [
        'createdAt',
        'authorName',
        'authorOrganisation',
        'authorCountry',
        'body',
        'likes',
        'dislikes',
        'reaction',
        'flagged',
        'hidden',
        'tracks',
        'interests',
      ].join(','),
      ...comments.map((c) =>
        [
          cell(c.createdAt),
          cell(c.authorName),
          cell(c.authorOrganisation),
          cell(c.authorCountry),
          cell(c.body),
          cell(c.likes),
          cell(c.dislikes),
          cell(c.reaction),
          cell(c.flagged),
          cell(c.hidden),
          list(c.tracks),
          list(c.interests),
        ].join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="thread-${sessionId}.csv"`,
    );
    // Excel reads a UTF-8 CSV as the system codepage unless it sees a BOM,
    // which turns every accented name in the delegate list into mojibake.
    res.send(`\uFEFF${rows.join('\r\n')}`);
  }
}
