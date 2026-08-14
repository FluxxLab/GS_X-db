import {Controller, Post, Get,Res, Put, Delete, Patch, Param, ParseUUIDPipe, Body, Query} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { DelegatesService } from './delegates.service';
import { Audit } from '../common/decorators/audit.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { AccessTier } from './entities/delegate.entity';
import { CreateRegistrationEntryDto } from './dto/create-delegate.dto';
import { SetTierDto } from './dto/set-tier.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { AuthUser } from 'src/auth/strategies/jwt.stategies';
import { UpdateMeDto } from './dto/update-me.dto';
import type {Response} from 'express';
import { EventSeverity } from '../security/entities/security-event.entity';
import { ListDelegatesDto } from './dto/list-delegates.dto';

@ApiTags('delegates')
@ApiBearerAuth()
@Controller('delegates')
export class DelegatesController {
    constructor(
        private readonly service: DelegatesService,
    ){}

@Get()
@Roles(AccessTier.ADMIN)
@ApiOperation({ summary: 'Delegate directory with filters' })
list(@Query() query: ListDelegatesDto) {
    return this.service.listDelegates(query);
}


@Post('registration-list')
@Roles(AccessTier.ADMIN)
@ApiOperation({ summary: 'Create a new delegate' })
@ApiResponse({ status: 201, description: 'Delegate created successfully' })
@ApiResponse({ status: 400, description: 'Bad request' })
@Audit({ type: 'registration_entry_added', description: 'Registration list entry'})
create(@Body() dto: CreateRegistrationEntryDto) {
    return this.service.addRegistrationEntry(dto);
}

@Get('registration-list')
@Roles(AccessTier.ADMIN)
@ApiOperation({ summary: 'Get all delegates' })
@ApiResponse({ status: 200, description: 'Delegates retrieved successfully' })
@ApiResponse({ status: 400, description: 'Bad request' })
@Audit({ type: 'registration_entry_added', description: 'Registration list entry'})
listEntries() {
    return this.service.listRegistrationEntries();
}


@Patch(':id/tier')
@Roles(AccessTier.ADMIN)
@ApiOperation({ summary: 'Update delegate tier' })
@ApiResponse({ status: 200, description: 'Delegate tier updated successfully' })
@ApiResponse({ status: 400, description: 'Bad request' })
@Audit({ type: 'tier_changed', description: 'Delegate access tier changed by admin', severity: EventSeverity.WARNING })
updateTier(@Param('id', new ParseUUIDPipe) id: string, @Body() dto: SetTierDto) {
    return this.service.setTier(id, dto.tier);
}

@Get('export')
@Roles(AccessTier.ADMIN)
@ApiOperation({ summary: 'Export delegates as CSV' })
@ApiResponse({ status: 200, description: 'Delegates exported successfully' })
@ApiResponse({ status: 400, description: 'Bad request' })
@Audit({ type: 'delegates_exported', description: 'Full delegate PII export downloaded', severity: EventSeverity.WARNING })
exportCsv(@Res() res: Response) {
    const csv = this.service.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send(csv);
}

@Get('me')
@ApiOperation({ summary: 'Get current user delegate' })
@ApiResponse({ status: 200, description: 'Current user delegate retrieved successfully' })
@ApiResponse({ status: 400, description: 'Bad request' })
me(@CurrentUser() user: AuthUser){
  return this.service.getProfile(user.id);
}

@Patch('me')
@ApiOperation({ summary: 'Update current user delegate' })
@ApiResponse({ status: 200, description: 'Current user delegate updated successfully' })
@ApiResponse({ status: 400, description: 'Bad request' })
updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
  return this.service.updateProfile(user.id, dto);
}

   



}