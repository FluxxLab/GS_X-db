import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../auth/strategies/jwt.stategies';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { SessionStatus } from '../sessions/entities/session.entity';
import { SessionsService } from '../sessions/sessions.service';
import { LivekitService } from './livekit.service';
import { CaptionsService } from './captions.service';
import { Audit } from 'src/common/decorators/audit.decorator';
import { EventSeverity } from 'src/security/entities/security-event.entity';
import type { Response } from 'express';

@ApiTags('captions')
@ApiBearerAuth()
@Controller('captions')
export class CaptionsController {
  constructor(
    private readonly livekit: LivekitService,
    private readonly sessions: SessionsService,
    private readonly captions: CaptionsService,
  ) {}

  @Get(':sessionid')
  @ApiOperation({ summary: 'Token to listen to a live session;s audio in app' })
  @ApiResponse({
    status: 200,
    description: '{url, token} for the Livekit room',
  })
  @ApiResponse({ status: 404, description: 'Session not found or not live' })
  @ApiResponse({ status: 503, description: 'Livekit not configure' })
  async listenToken(
    @Param('sessionid', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const session = await this.sessions.findById(sessionId);

    if (session.status !== SessionStatus.LIVE) {
      throw new NotFoundException('Session is not live');
    }

    return {
      url: this.livekit.serverUrl(),
      token: await this.livekit.listenerToken(session.room, user.id),
    };
  }

  @Post('rooms/:room/publish-token')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Token to publish captions to a live session' })
  @ApiResponse({
    status: 200,
    description: '{url, token} for the Livekit room',
  })
  @ApiResponse({ status: 404, description: 'Session not found or not live' })
  @ApiResponse({ status: 503, description: 'Livekit not configure' })
  async publishToken(
    @Param('room') room: string,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      url: this.livekit.serverUrl(),
      token: await this.livekit.publisherToken(room, user.id),
    };
  }

  @Get(':/sessionId/transcript')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'full caption transcript for a session(admin' })
  transcript(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.captions.fullTranscript(sessionId);
  }

  @Get(':sessionId/transcript/export')
  @Roles(AccessTier.ADMIN)
  @Audit({
    type: 'transcript_exported',
    description: 'Session transcript exported',
    severity: EventSeverity.WARNING,
  })
  @ApiOperation({
    summary: 'Export a session transcript as CSV or TXT (admin, audited)',
  })
  async exportTranscript(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query('format') format: string = 'csv',
    @Res() res: Response,
  ) {
    const segments = await this.captions.fullTranscript(sessionId);
    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(
        segments
          .map((s) => `[${s.createdAt.toISOString()}] ${s.text}`)
          .join('\n'),
      );
    }
    const cell = (v: string | number | boolean | null | undefined) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      'createdAt,room,source,text',
      ...segments.map((s) =>
        [s.createdAt.toISOString(), s.room, s.source, cell(s.text)].join(','),
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(rows.join('\n'));
  }
}
