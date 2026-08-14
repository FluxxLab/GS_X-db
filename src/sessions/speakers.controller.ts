import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { CreateSpeakerDto } from './dto/create-speaker.dto';
import { SessionsService } from './sessions.service';

@ApiTags('Speakers')
@ApiBearerAuth()
@Controller('speakers')
export class SpeakersController {
  constructor(private readonly service: SessionsService) {}

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
}
