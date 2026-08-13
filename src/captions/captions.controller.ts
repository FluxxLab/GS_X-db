import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthUser } from '../auth/strategies/jwt.stategies';
import { AccessTier } from '../delegate/entities/delegate.entity';
import { SessionStatus } from '../sessions/entities/session.entity';
import { SessionsService } from '../sessions/sessions.service';
import { LivekitService } from './livekit.service';


@ApiTags('captions')
@ApiBearerAuth()
@Controller('captions')
export class CaptionsController {
    constructor(
        private readonly livekit: LivekitService,
        private readonly sessions: SessionsService,
    ){}

    @Get(':sessionid')
    @ApiOperation({ summary: 'Token to listen to a live session;s audio in app'})
    @ApiResponse({ status: 200, description: '{url, token} for the Livekit room'})
    @ApiResponse({status: 404, description: "Session not found or not live"})
    @ApiResponse({status: 503, description: 'Livekit not configure'})
    async listenToken(
        @Param('sessionid', ParseUUIDPipe) sessionId: string,
        @CurrentUser() user: AuthUser
    ){
       const session = await this.sessions.findById(sessionId);

       if(session.status !== SessionStatus.LIVE){
        throw new NotFoundException('Session is not live');
       }

       return {
        url: this.livekit.serverUrl(),
        token: await this.livekit.listenerToken(session.room, user.id),
       };
    }


    @Post('rooms/:room/publish-token')
    @Roles(AccessTier.ADMIN)
    @ApiOperation({ summary: 'Token to publish captions to a live session'})
    @ApiResponse({ status: 200, description: '{url, token} for the Livekit room'})
    @ApiResponse({status: 404, description: "Session not found or not live"})
    @ApiResponse({status: 503, description: 'Livekit not configure'})
    async publishToken(
       @Param('room') room: string,
       @CurrentUser() user: AuthUser
    ){
        return{
            url: this.livekit.serverUrl(),
            token: await this.livekit.publisherToken(room, user.id),
        }
       
    }
}
