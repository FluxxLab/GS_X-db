import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { SetCutToBreakDto } from './dto/set-cut-to-break.dto';
import { setOverlaysDto } from './dto/set-overlays.dto';
import { LiveOpsService } from './live-ops.service';
import { Audit } from 'src/common/decorators/audit.decorator';

@ApiTags('Live Ops')
@ApiBearerAuth()
@Controller('live-ops')
export class LiveOpsController{
    constructor(
        private readonly service: LiveOpsService,
    ){}

    @Get('overview')
    @ApiOperation({ summary: 'Current broadcast flags - delegate apps fetch this on launch'})
    @Roles(AccessTier.ADMIN)
    overview(){
        return this.service.overview();
    }

    @Post('cut-to-break')
    @Roles(AccessTier.ADMIN)
    @Audit({type: 'cut-to-break', description: 'Cut all streams to break - broadcast: flags'})
    @ApiOperation({ summary: 'Cut all streams to break - broadcast: flags'})
    cutToBreak(@Body() dto: SetCutToBreakDto){
        return this.service.setCutToBreak(dto.active);
    }


    @Get('flags')
    @ApiOperation({
        summary: 'Current broadcast flag - delegate apps this on launch'
    })
    flags(){
        return this.service.getflags();
    }

    @Post('set-overlays')
  @Roles(AccessTier.ADMIN)
  @Audit({ type: 'overlays_changed', description: 'Stream overlays changed' })
  @ApiOperation({ summary: 'Toggle captions / sign-language overlays' })
  overlays(@Body() dto: setOverlaysDto) {
    return this.service.setOverlays(dto);
  }


}