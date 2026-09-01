import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import type { AuthUser } from '../auth/strategies/jwt.stategies';
import { CreateSpeakerDto } from './dto/create-speaker.dto';
import { SetSpeakerRevealDto } from './dto/set-speaker-reveal.dto';
import { SessionsService } from './sessions.service';
import { AvatarUploadDto } from '../delegate/dto/avatar-upload.dto';
import { StorageService } from '../common/storage/storage.service';

@ApiTags('Speakers')
@ApiBearerAuth()
@Controller('speakers')
export class SpeakersController {
  constructor(
    private readonly service: SessionsService,
    private readonly storage: StorageService,
  ) {}

  // Not @Public(): empty for delegates until the line-up is revealed, full for
  // admin, and telling those apart needs the caller.
  @Get()
  @ApiOperation({
    summary: 'List all speakers - empty for delegates before the reveal',
  })
  list(@CurrentUser() user: AuthUser) {
    return this.service.listSpeakers(user.role === AccessTier.ADMIN);
  }

  /**
   * The reveal switch. Readable by everyone because the clients need to know
   * which copy to render ("To be announced" vs the real line-up); writable by
   * admin only.
   */
  @Get('reveal')
  @ApiOperation({ summary: 'Whether speaker identities are public yet' })
  async revealState() {
    return { revealed: await this.service.speakersRevealed() };
  }

  @Post('reveal')
  @HttpCode(200)
  @Roles(AccessTier.ADMIN)
  @ApiOperation({
    summary:
      'Reveal or re-hide every speaker identity across the summit. Broadcasts ' +
      'speakers:revealed so open apps update without relaunching.',
  })
  setReveal(@Body() dto: SetSpeakerRevealDto) {
    return this.service.setSpeakersRevealed(dto.revealed);
  }

  @Post()
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Create a speaker' })
  create(@Body() dto: CreateSpeakerDto) {
    return this.service.createSpeaker(dto);
  }
  @Post('avatar-upload')
  @Roles(AccessTier.ADMIN)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Signed URL for a speaker photo: PUT the file to uploadUrl, then send publicUrl as avatarUrl when creating the speaker',
  })
  avatarUpload(@Body() dto: AvatarUploadDto) {
    return this.storage.presignUpload({
      folder: 'speaker-avatars',
      contentType: dto.contentType,
    });
  }
}
