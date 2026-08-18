import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { CreateSpeakerDto } from './dto/create-speaker.dto';
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

  @Public()
  @Get()
  @ApiOperation({ summary: 'List all speakers' })
  list() {
    return this.service.listSpeakers();
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
