import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { QueryEventsDto } from './dto/query-events.dto';
import { SecurityService } from './security.service';

@ApiTags('security')
@ApiBearerAuth()
@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('events')
  @ApiOperation({ summary: 'Get security events' })
  @ApiResponse({
    status: 200,
    description: 'Security events retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(AccessTier.ADMIN)
  async getEvents(@Query() query: QueryEventsDto) {
    return this.security.list(query);
  }
}
