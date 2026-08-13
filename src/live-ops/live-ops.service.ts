import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { REDIS } from '../common/redis/redis.module';
import { SessionsService } from '../sessions/sessions.service';

const FLAG_KEYS = {
    cutToBreak: 'liveops:cutToBreak',
    captionsOverlay: 'liveops:captionsOverlay',
    signLanguageOverlay: 'liveops:signLanguageOverlay',
} as const;

export interface BroadcastFlags {
    cutToBreak: boolean;
    captionsOverlay: boolean;
    signLanguageOverlay: boolean;
    
}

@Injectable()
export class LiveOpsService {
    constructor(
        @Inject(REDIS) 
        private readonly redis: Redis,
        private readonly sessionsService: SessionsService,
        private readonly realtime: RealtimeService,
    ){}

    async overview(){
        const liveSessions =await this.sessionsService.findLiveNow();
        const sessions = await Promise.all(
        liveSessions.map(async (s) => ({
            id: s.id,
            title: s.title,
            room: s.room,
            viewers: await this.realtime.roomSize(Rooms.session(s.id)),
            captionListeners: await this.realtime.roomSize(Rooms.caption(s.id)),
            capturing: (await this.redis.exists(`capture:room:${s.room}`)) ===1,
        })),
    );
    return {sessions, flags: await this.getflags()};
    }

    async setCutToBreak(active: boolean): Promise<BroadcastFlags>{
        await this.redis.set(FLAG_KEYS.cutToBreak, active ? '1' : '0');
        return this.broadcastFlags();
    }

    async setOverlays(input: {captions?: boolean; signLanguage?: boolean}): Promise<BroadcastFlags>{
    if(input.captions !== undefined){
        await this.redis.set(FLAG_KEYS.captionsOverlay, input.captions ? '1' : '0');
    }
    if(input.signLanguage !== undefined){
        await this.redis.set(FLAG_KEYS.signLanguageOverlay, input.signLanguage ? '1' : '0');
    }
    return this.broadcastFlags();
}

    
    async getflags(): Promise<BroadcastFlags> {
        const [cut, cap, sign] = await this.redis.mget(
            FLAG_KEYS.cutToBreak,
            FLAG_KEYS.captionsOverlay,
            FLAG_KEYS.signLanguageOverlay,
        );
        return {
            cutToBreak: cut === '1',
            captionsOverlay: cap === '1',
            signLanguageOverlay: sign === '1',
        };
    }

    private async broadcastFlags():Promise<BroadcastFlags>{
        const flags = await this.getflags();
        this.realtime.emitGlobal('broadcast:flags', flags);
        return flags;
    }
}