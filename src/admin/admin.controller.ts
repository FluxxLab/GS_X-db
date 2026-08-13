import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { AdminService } from './admin.service';


@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
    constructor(private readonly service: AdminService){}

    @Get('overview')
    @Roles(AccessTier.ADMIN)
    @ApiOperation({summary: 'Overview dashboard'})
    overview(){
        return this.service.overview();
    }
}