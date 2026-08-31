import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Param,
  ParseUUIDPipe,
  HttpCode,
  Body,
} from '@nestjs/common';
import { Audit } from 'src/common/decorators/audit.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VotingService } from './voting.service';
import { CreatePitchEntryDto } from './dto/create-pitch-entry.dto';
import { UpdatePitchEntryDto } from './dto/update-pitch-entry.dto';
import { CreatePitchTopicDto } from './dto/create-pitch-topic.dto';
import { UpdatePitchTopicDto } from './dto/update-pitch-topic.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { AccessTier } from 'src/delegate/entities/delegate.entity';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { AuthUser } from 'src/auth/strategies/jwt.stategies';

@ApiTags('Voting')
@ApiBearerAuth()
@Controller('voting')
export class VotingController {
  constructor(private readonly votingService: VotingService) {}

  /* ---------------------------------------------------------------- topics */

  // Not @Public(): what comes back depends on who is asking. A pending topic
  // and its pitches are withheld until voting opens, and only admin - who
  // curates them - sees them before that.
  @Get('topics')
  @ApiOperation({
    summary:
      'Topics with their pitches, live standing and voting state. Pending ' +
      'topics are withheld from everyone but admin until voting opens.',
  })
  listTopics(@CurrentUser() user: AuthUser) {
    return this.votingService.listTopics(user.role === AccessTier.ADMIN);
  }

  @Post('topics')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Create a pitchathon topic' })
  @Audit({ type: 'pitch_topic_created', description: 'Pitch topic created' })
  createTopic(@Body() dto: CreatePitchTopicDto) {
    return this.votingService.createTopic(dto);
  }

  @Patch('topics/:id')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Rename or reorder a topic' })
  updateTopic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePitchTopicDto,
  ) {
    return this.votingService.updateTopic(id, dto);
  }

  @Post('topics/:id/open')
  @HttpCode(200)
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Open the ballot for a topic' })
  @Audit({ type: 'pitch_voting_opened', description: 'Pitch voting opened' })
  openVoting(@Param('id', ParseUUIDPipe) id: string) {
    return this.votingService.openVoting(id);
  }

  @Post('topics/:id/close')
  @HttpCode(200)
  @Roles(AccessTier.ADMIN)
  @ApiOperation({
    summary: 'Close the ballot and freeze the result that gets announced',
  })
  @Audit({ type: 'pitch_voting_closed', description: 'Pitch voting closed' })
  closeVoting(@Param('id', ParseUUIDPipe) id: string) {
    return this.votingService.closeVoting(id);
  }

  @Delete('topics/:id')
  @HttpCode(204)
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Remove a topic, its pitches and its ballots' })
  @Audit({ type: 'pitch_topic_deleted', description: 'Pitch topic deleted' })
  async removeTopic(@Param('id', ParseUUIDPipe) id: string) {
    await this.votingService.removeTopic(id);
  }

  /* --------------------------------------------------------------- entries */

  // Both of these reach the same pitches without the topic wrapper, so they
  // carry the same rule - otherwise the withheld line-up is one request away.
  @Get('entries')
  @ApiOperation({
    summary: 'Pitch entries, excluding those on a topic that has not opened',
  })
  listEntries(@CurrentUser() user: AuthUser) {
    return this.votingService.listEntries(user.role === AccessTier.ADMIN);
  }

  @Get('top-pitches')
  @ApiOperation({
    summary: 'Most-voted pitches across all open topics (Overview widget)',
  })
  topPitches(@CurrentUser() user: AuthUser) {
    return this.votingService.topPitches(10, user.role === AccessTier.ADMIN);
  }

  @Post('entries')
  @ApiOperation({ summary: 'Create a new pitch entry' })
  @Roles(AccessTier.ADMIN)
  createEntry(@Body() dto: CreatePitchEntryDto) {
    return this.votingService.createEntry(dto);
  }

  @Patch('entries/:id')
  @ApiOperation({ summary: 'Edit a pitch entry (ballots are not affected)' })
  @Roles(AccessTier.ADMIN)
  @Audit({ type: 'pitch_entry_updated', description: 'Pitch entry updated' })
  updateEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePitchEntryDto,
  ) {
    return this.votingService.updateEntry(id, dto);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a pitch entry and every ballot cast on it' })
  @Roles(AccessTier.ADMIN)
  @Audit({ type: 'pitch_entry_deleted', description: 'Pitch entry deleted' })
  async removeEntry(@Param('id', ParseUUIDPipe) id: string) {
    await this.votingService.removeEntry(id);
  }

  /* ----------------------------------------------------------------- votes */

  @Post('entry/:id/vote')
  @ApiOperation({
    summary:
      "Cast or change this delegate's vote in the pitch's topic. One ballot " +
      'per delegate per topic; re-casting moves it. Returns the topic tally.',
  })
  @HttpCode(200)
  vote(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.votingService.castVote(user.id, id);
  }

  @Get('my-votes')
  @ApiOperation({ summary: 'topicId -> entryId this delegate has voted for' })
  myVotes(@CurrentUser() user: AuthUser) {
    return this.votingService.myVotes(user.id);
  }
}
