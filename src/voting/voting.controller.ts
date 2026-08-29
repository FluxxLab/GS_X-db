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
import { Public } from 'src/common/decorators/public.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { AccessTier } from 'src/delegate/entities/delegate.entity';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { AuthUser } from 'src/auth/strategies/jwt.stategies';

@ApiTags('Voting')
@ApiBearerAuth()
@Controller('voting')
export class VotingController {
  constructor(private readonly votingService: VotingService) {}

  @Public()
  @Get('entries')
  @ApiOperation({ summary: 'List all pitch entries' })
  listEntries() {
    return this.votingService.listEntries();
  }

  @Public()
  @Get('leaderboard')
  @ApiOperation({ summary: 'Get leaderboard' })
  leaderboard() {
    return this.votingService.leaderboard(10);
  }

  @Post('entries')
  @ApiOperation({ summary: 'Create a new pitch entry' })
  @Roles(AccessTier.ADMIN)
  createEntry(@Body() dto: CreatePitchEntryDto) {
    return this.votingService.createEntry(dto);
  }

  @Patch('entries/:id')
  @ApiOperation({ summary: 'Edit a pitch entry (votes are not affected)' })
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
  @ApiOperation({ summary: 'Remove a pitch entry and every vote cast for it' })
  @Roles(AccessTier.ADMIN)
  @Audit({ type: 'pitch_entry_deleted', description: 'Pitch entry deleted' })
  async removeEntry(@Param('id', ParseUUIDPipe) id: string) {
    await this.votingService.removeEntry(id);
  }

  @Post('entry/:id/vote')
  @ApiOperation({ summary: 'Vote for a pitch entry' })
  @HttpCode(200)
  vote(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.votingService.castVote(user.id, id);
  }

  @Get('my-votes')
  @ApiOperation({ summary: 'Entry ids te caller has voted for' })
  myVotes(@CurrentUser() user: AuthUser) {
    return this.votingService.myVotes(user.id);
  }
}
