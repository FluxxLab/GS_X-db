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
  Query,
  ParseArrayPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { QuerySessionsDto } from './dto/query-sessions.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { UpdateSessionStatusDto } from './dto/update-session-status.dto';
import { SessionsService } from './sessions.service';
import type { AuthUser } from 'src/auth/strategies/jwt.stategies';
import { Audit } from 'src/common/decorators/audit.decorator';

@Controller('sessions')
@ApiBearerAuth()
@ApiTags('sessions')
export class SessionController {
  constructor(private readonly service: SessionsService) {}

  // Not @Public(): speakers are withheld until the organisers reveal them, and
  // that rule needs to know who is asking - a public handler has no user, so
  // admin could not be exempted from it.
  @Get()
  @ApiOperation({})
  async list(@Query() query: QuerySessionsDto, @CurrentUser() user: AuthUser) {
    const rows = await this.service.list(query);
    return this.service.withSpeakerReveal(rows, user.role === AccessTier.ADMIN);
  }

  @Get('live')
  @ApiOperation({})
  async liveNow(@CurrentUser() user: AuthUser) {
    const rows = await this.service.findLiveNow();
    return this.service.withSpeakerReveal(rows, user.role === AccessTier.ADMIN);
  }

  @Get('saved')
  @ApiOperation({})
  async saved(@CurrentUser() user: AuthUser) {
    const rows = await this.service.savedSessions(user.id);
    return this.service.withSpeakerReveal(rows, user.role === AccessTier.ADMIN);
  }

  /**
   * The single source of truth for tracks.
   *
   * Declared before :id so the router does not try to parse "tracks" as a
   * UUID. Public because every client needs it before a delegate has logged
   * in, and because a hardcoded copy in each app is how the three of them
   * drifted apart - the database enum rejects anything not listed here, so a
   * client-side list that disagrees produces a 400 nobody can explain.
   */
  @Public()
  @Get('tracks')
  @ApiOperation({
    summary: 'Session tracks, as the database enum defines them',
  })
  tracks() {
    return this.service.tracks();
  }

  @Get(':id')
  @ApiOperation({})
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const session = await this.service.findById(id);
    const [redacted] = await this.service.withSpeakerReveal(
      [session],
      user.role === AccessTier.ADMIN,
    );
    return redacted;
  }

  @Post()
  @ApiOperation({})
  @Roles(AccessTier.ADMIN)
  create(@Body() dto: CreateSessionDto) {
    return this.service.create(dto);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk create sessions' })
  @Roles(AccessTier.ADMIN)
  createBulk(
    @Body(new ParseArrayPipe({ items: CreateSessionDto }))
    dtos: CreateSessionDto[],
  ) {
    return this.service.createBulk(dtos);
  }

  @Patch(':id')
  @ApiOperation({})
  @Roles(AccessTier.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({})
  @Roles(AccessTier.ADMIN)
  @Audit({
    type: 'session_status_changed',
    description: 'Session status changed',
  })
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSessionStatusDto,
  ) {
    return this.service.setStatus(id, dto.status);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(AccessTier.ADMIN)
  @Audit({ type: 'session_deleted', description: 'Session deleted' })
  @ApiOperation({
    summary:
      'Delete a session with its bookmarks, attendance, comments and transcript',
  })
  @ApiQuery({
    name: 'force',
    required: false,
    description:
      'Required to delete a session that has attendance, comments or captions',
  })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({
    status: 409,
    description: 'Session has activity; retry with force=true',
  })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('force') force?: string,
  ) {
    await this.service.remove(id, force === 'true');
  }

  @Post(':id/bookmark')
  @HttpCode(204)
  @ApiOperation({})
  async bookmark(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.bookmark(user.id, id);
  }

  @Delete(':id/bookmark')
  @HttpCode(204)
  @ApiOperation({})
  async unbookmark(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.unbookmark(user.id, id);
  }
}
