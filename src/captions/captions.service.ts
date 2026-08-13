import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { TranscriptSegment } from './entities/transcript-segment.entity';
import { TRANSCRIPTION_PROVIDER } from './transcription/transcription.interface';
import type {
  TranscriptEvent, TranscriptionProvider, TranscriptionStream,
} from './transcription/transcription.interface';
import { REDIS } from 'src/common/redis/redis.module';
import { Redis } from 'ioredis';

/**
 * extends from the agenda 
 */
const SUMMIT_KEYWORDS = ['Pitchathon', 'GBV', 'GS-26'];

@Injectable()
export class CaptionsService implements OnModuleDestroy {
    private readonly logger = new Logger(CaptionsService.name);

    /**
     * Connection state, not domain states: each Deepgram stream is bound to the instance
     * holding the capture socket; caption fan-out still reaches every instance via the Redis adapter.
     */
    private readonly activeRooms = new Map<string, TranscriptionStream>();

    constructor(
        @InjectRepository(TranscriptSegment)
        private readonly segments: Repository<TranscriptSegment>,
        @Inject(TRANSCRIPTION_PROVIDER)
        private readonly transcription: TranscriptionProvider,
        private readonly session: SessionsService,
        private readonly realtime: RealtimeService,
        @Inject(REDIS)
        private readonly redis: Redis,
    ){}


    async startRoom(room: string): Promise<void> {
        if(this.activeRooms.has(room)) return; // indempotent - capture page reconnect happen
   
        const stream = await this.transcription.openStream(
            {room, keywords: SUMMIT_KEYWORDS},
            (event) => void this.onTranscript(room, event),
        );
        this.activeRooms.set(room, stream);
        await this.redis.set(this.captureKey(room), new Date().toISOString(), 'EX', 30);
    } 


    sendAudio(room: string, chunk: Buffer): void {
        this.activeRooms.get(room)?.sendAudio(chunk);
    } 

    async stopRoom(room: string): Promise<void> {
        await this.activeRooms.get(room)?.close();
        await this.redis.del(this.captureKey(room));
        this.activeRooms.delete(room);
    }

    isActive(room: string): boolean{
        return this.activeRooms.has(room);
    }

    private async onTranscript(room: string, event: TranscriptEvent):Promise<void>{
        await this.redis.set(this.captureKey(room), new Date().toISOString(), 'EX', 30)
        const session = await this.session.findLiveInRoom(room); 
        if(!session) return; // break time - nothing live in this room, drop the fragment 
        
        this.realtime.emitToRoom(Rooms.caption(session.id), 'caption',{
            sessionId: session.id,
            text: event.text,
            isFinal: event.isFinal,
            aiGenerated: true,
            at: new Date().toISOString(),
        });

        if(event.isFinal){
            await this.segments.save(
                this.segments.create({sessionId: session.id, room, text: event.text }),
            )
        }
}

fullTranscript(sessionId: string): Promise<TranscriptSegment[]>{
    
    return this.segments.find({where: {sessionId}, order: {createdAt: 'ASC'}})
}

async onModuleDestroy(): Promise<void> {
    for (const [room, stream] of this.activeRooms){
        await stream.close().catch(() => this.logger.warn(`close failed (${room})`));
    }
}


private captureKey(room: string){
    return `capture: room: ${room}`;
}

}