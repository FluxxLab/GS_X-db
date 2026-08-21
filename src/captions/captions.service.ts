import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { SessionsService } from '../sessions/sessions.service';
import { TranscriptSegment } from './entities/transcript-segment.entity';
import { TRANSCRIPTION_PROVIDER } from './transcription/transcription.interface';
import type {
  TranscriptEvent,
  TranscriptionProvider,
  TranscriptionStream,
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

  /**
   * Audio that arrived while Deepgram was still connecting. The first
   * MediaRecorder chunk carries the WebM/EBML header; every later chunk is a
   * bare Opus cluster that cannot be decoded without it. Dropping the header
   * because the stream was not open yet makes Deepgram reject the audio and
   * close the socket, so these are queued and flushed in order instead.
   */
  private readonly pendingAudio = new Map<string, Buffer[]>();

  constructor(
    @InjectRepository(TranscriptSegment)
    private readonly segments: Repository<TranscriptSegment>,
    @Inject(TRANSCRIPTION_PROVIDER)
    private readonly transcription: TranscriptionProvider,
    private readonly session: SessionsService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS)
    private readonly redis: Redis,
  ) {}

  async startRoom(room: string): Promise<void> {
    // indempotent - capture page reconnect happen
    if (this.activeRooms.has(room) || this.pendingAudio.has(room)) return;

    this.pendingAudio.set(room, []);
    let stream: TranscriptionStream;
    try {
      stream = await this.transcription.openStream(
        { room, keywords: SUMMIT_KEYWORDS },
        (event) => void this.onTranscript(room, event),
      );
    } catch (error) {
      this.pendingAudio.delete(room);
      throw error;
    }
    this.activeRooms.set(room, stream);

    const queued = this.pendingAudio.get(room) ?? [];
    this.pendingAudio.delete(room);
    for (const chunk of queued) this.sendAudio(room, chunk);

    await this.redis.set(
      this.captureKey(room),
      new Date().toISOString(),
      'EX',
      30,
    );
  }

  sendAudio(room: string, chunk: Buffer): void {
    const queue = this.pendingAudio.get(room);
    if (queue) {
      queue.push(chunk);
      return;
    }

    const stream = this.activeRooms.get(room);
    if (!stream) return;

    try {
      stream.sendAudio(chunk);
    } catch (error) {
      /**
       * Deepgram hung up. Forget the room rather than throw once per 250ms
       * chunk: the capture heartbeat then expires and live-ops shows the room
       * unhealthy, which is the signal an operator can act on.
       */
      this.activeRooms.delete(room);
      this.logger.warn(
        `Deepgram stream unusable (${room}): ${(error as Error).message}`,
      );
    }
  }

  async stopRoom(room: string): Promise<void> {
    this.pendingAudio.delete(room);
    await this.activeRooms.get(room)?.close();
    await this.redis.del(this.captureKey(room));
    this.activeRooms.delete(room);
  }

  isActive(room: string): boolean {
    return this.activeRooms.has(room);
  }

  private async onTranscript(
    room: string,
    event: TranscriptEvent,
  ): Promise<void> {
    await this.redis.set(
      this.captureKey(room),
      new Date().toISOString(),
      'EX',
      30,
    );
    const session = await this.session.findLiveInRoom(room);
    if (!session) return; // break time - nothing live in this room, drop the fragment

    this.realtime.emitToRoom(Rooms.caption(session.id), 'caption', {
      sessionId: session.id,
      text: event.text,
      isFinal: event.isFinal,
      aiGenerated: true,
      at: new Date().toISOString(),
    });

    if (event.isFinal) {
      await this.segments.save(
        this.segments.create({ sessionId: session.id, room, text: event.text }),
      );
    }
  }

  fullTranscript(sessionId: string): Promise<TranscriptSegment[]> {
    return this.segments.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  async onModuleDestroy(): Promise<void> {
    for (const [room, stream] of this.activeRooms) {
      await stream
        .close()
        .catch(() => this.logger.warn(`close failed (${room})`));
    }
  }

  private captureKey(room: string) {
    return `capture: room: ${room}`;
  }
}
