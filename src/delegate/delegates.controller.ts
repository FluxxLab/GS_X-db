import {
  Controller,
  Post,
  Get,
  Delete,
  Res,
  Patch,
  Param,
  ParseUUIDPipe,
  Body,
  Query,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { DelegatesService } from './delegates.service';
import { Audit } from '../common/decorators/audit.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from './entities/delegate.entity';
import {
  CreateRegistrationEntryDto,
  UpdateRegistrationEntryDto,
} from './dto/create-delegate.dto';
import { SetTierDto } from './dto/set-tier.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.stategies';
import { UpdateMeDto } from './dto/update-me.dto';
import type { Response } from 'express';
import { EventSeverity } from '../security/entities/security-event.entity';
import { ListDelegatesDto } from './dto/list-delegates.dto';
import { SetAdminDto } from './entities/set-admin.dto';
import { DelegateDirectoryDto } from './dto/delegate-directory.dto';
import { ListDirectoryDto } from './dto/list-directory.dto';
import { SendDirectMessageDto } from './dto/send-direct-message.dto';
import { AvatarUploadDto } from './dto/avatar-upload.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';

@ApiTags('delegates')
@ApiBearerAuth()
@Controller('delegates')
export class DelegatesController {
  constructor(private readonly service: DelegatesService) {}

  @Get()
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Delegate directory with filters' })
  list(@Query() query: ListDelegatesDto) {
    return this.service.listDelegates(query);
  }

  @Public()
  @Get('directory')
  @ApiOperation({
    summary:
      'Public delegate directory — safe fields only, excludes pending/flagged',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list of delegates visible to all logged-in users (no PII)',
    type: DelegateDirectoryDto,
    isArray: true,
  })
  directory(@Query() query: ListDirectoryDto) {
    return this.service.listDelegatesPublic(query);
  }

  @Post('registration-list')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Create a new delegate' })
  @ApiResponse({ status: 201, description: 'Delegate created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Audit({
    type: 'registration_entry_added',
    description: 'Registration list entry',
  })
  create(@Body() dto: CreateRegistrationEntryDto) {
    return this.service.addRegistrationEntry(dto);
  }

  @Get('registration-list')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Get all delegates' })
  @ApiResponse({ status: 200, description: 'Delegates retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Audit({
    type: 'registration_entry_added',
    description: 'Registration list entry',
  })
  listEntries() {
    return this.service.listRegistrationEntries();
  }

  @Patch('registration-list/:id')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Update a registration list entry' })
  @ApiResponse({ status: 200, description: 'Entry updated successfully' })
  @Audit({
    type: 'registration_entry_updated',
    description: 'Registration list entry updated',
  })
  updateEntry(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRegistrationEntryDto,
  ) {
    return this.service.updateRegistrationEntry(id, dto);
  }

  @Delete('registration-list/:id')
  @Roles(AccessTier.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a registration list entry' })
  @ApiResponse({ status: 204, description: 'Entry deleted successfully' })
  @Audit({
    type: 'registration_entry_deleted',
    description: 'Registration list entry deleted',
  })
  deleteEntry(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.deleteRegistrationEntry(id);
  }

  @Patch(':id/tier')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Update delegate tier' })
  @ApiResponse({
    status: 200,
    description: 'Delegate tier updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Audit({
    type: 'tier_changed',
    description: 'Delegate access tier changed by admin',
    severity: EventSeverity.WARNING,
  })
  updateTier(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetTierDto,
  ) {
    return this.service.setTier(id, dto.tier);
  }

  @Get('export')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Export delegates as CSV' })
  @ApiResponse({ status: 200, description: 'Delegates exported successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Audit({
    type: 'delegates_exported',
    description: 'Full delegate PII export downloaded',
    severity: EventSeverity.WARNING,
  })
  exportCsv(@Res() res: Response) {
    const csv = this.service.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(csv);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user delegate' })
  @ApiResponse({
    status: 200,
    description: 'Current user delegate retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  me(@CurrentUser() user: AuthUser) {
    return this.service.profileView(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user delegate' })
  @ApiResponse({
    status: 200,
    description: 'Current user delegate updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.service.updateProfile(user.id, dto);
  }

  @Post('me/avatar-upload')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Signed URL for a profile photo: PUT the file to uploadUrl, then PATCH /delegates/me with the publicUrl',
  })
  @ApiResponse({ status: 200, description: 'uploadUrl, key and publicUrl' })
  @ApiResponse({
    status: 503,
    description: 'Uploads are not configured (no S3_BUCKET)',
  })
  avatarUpload(@Body() dto: AvatarUploadDto) {
    return this.service.presignAvatar(dto.contentType);
  }

  @Delete('me')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete your account and all data identifying you. Irreversible; confirmed with your password.',
  })
  @ApiResponse({
    status: 204,
    description: 'Account and personal data removed',
  })
  @ApiResponse({ status: 401, description: 'Password is incorrect' })
  @Audit({
    type: 'delegate_deleted_account',
    description: 'Delegate deleted their own account',
    severity: EventSeverity.WARNING,
  })
  async deleteMe(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto) {
    await this.service.deleteAccount(user.id, dto.password);
  }

  @Get('admins')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'List accounts with admin access' })
  listAdmins() {
    return this.service.listAdmins();
  }

  @Patch(':id/admin')
  @Roles(AccessTier.ADMIN)
  @ApiOperation({ summary: 'Grant or revoke admin access' })
  @Audit({
    type: 'admin_access_changed',
    description: 'Admin access granted or revoked',
    severity: EventSeverity.CRITICAL,
  })
  setAdmin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetAdminDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setAdmin(id, dto.admin, user.id);
  }

  @Post(':id/connect')
  @ApiOperation({
    summary:
      'Add delegate to your network (pink ➕ person button). If mutual, marks connection as mutual.',
  })
  @ApiResponse({
    status: 201,
    description: 'Connection created or promoted to mutual',
  })
  connect(
    @Param('id', new ParseUUIDPipe()) toDelegateId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addConnection(user.id, toDelegateId);
  }

  @Get('me/connections')
  @ApiOperation({
    summary: 'List delegates in your network (the "N in your network" counter)',
  })
  async myConnections(@CurrentUser() user: AuthUser) {
    const [connections, count] = await Promise.all([
      this.service.listConnections(user.id),
      this.service.countConnections(user.id),
    ]);
    return { count, connections };
  }

  // Declared above the ':id' catch-all, like every other static path.
  @Get('me/conversations')
  @ApiOperation({
    summary:
      'Your DM threads (message inbox): other delegate, last message, unread count',
  })
  myConversations(@CurrentUser() user: AuthUser) {
    return this.service.listConversations(user.id);
  }

  @Post(':id/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a direct message (chat bubble 💬 button)' })
  @ApiResponse({ status: 200, description: 'Message delivered and persisted' })
  sendDm(
    @Param('id', new ParseUUIDPipe()) recipientId: string,
    @Body() dto: SendDirectMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.sendDirectMessage(user.id, recipientId, dto);
  }

  @Get(':id/messages')
  @ApiOperation({
    summary:
      'Get message thread with this delegate (opens the chat bubble conversation, marks messages as read)',
  })
  threadWith(
    @Param('id', new ParseUUIDPipe()) otherDelegateId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.listThread(user.id, otherDelegateId);
  }

  // Declared last so every static path above ('directory', 'me', 'export',
  // 'admins', 'registration-list') is matched before this catch-all segment.
  @Get(':id')
  @ApiOperation({
    summary:
      'Single delegate — safe fields only. Includes delegates pending review (scanned QR passes resolve here); excludes flagged.',
  })
  @ApiResponse({ status: 200, type: DelegateDirectoryDto })
  @ApiResponse({ status: 404, description: 'Delegate not found or flagged' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findDirectoryEntry(id);
  }
}
