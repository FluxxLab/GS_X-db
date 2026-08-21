import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { Rooms } from '../common/realtime/realtime.service';
import { CaptionsService } from './captions.service';
import { CaptionLanguage, toCaptionLanguage } from './translation/languages';

/**
 * Delegates on older builds send a bare sessionId, which means English.
 */
type CaptionSubscription = string | { sessionId: string; language?: string };

function parseSubscription(body: CaptionSubscription): {
  sessionId: string;
  language: CaptionLanguage;
} {
  if (typeof body === 'string') {
    return { sessionId: body, language: CaptionLanguage.EN };
  }
  return {
    sessionId: body.sessionId,
    language: toCaptionLanguage(body.language),
  };
}

@WebSocketGateway({ cors: { origin: '*' } })
export class CaptionsGateway {
  constructor(private readonly captionsService: CaptionsService) {}

  /**
   * delegate side
   */
  @SubscribeMessage('captions:join')
  join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: CaptionSubscription,
  ) {
    const { sessionId, language } = parseSubscription(body);
    socket.join(Rooms.caption(sessionId, language));
    return { joined: sessionId, language };
  }

  @SubscribeMessage('captions:leave')
  leave(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: CaptionSubscription,
  ) {
    const { sessionId, language } = parseSubscription(body);
    socket.leave(Rooms.caption(sessionId, language));
    return { left: sessionId, language };
  }

  /**
   * capture side (admin/ capture page)
   */
  @SubscribeMessage('capture:start')
  async startCapture(
    @ConnectedSocket() socket: Socket,
    @MessageBody() room: string,
  ) {
    if (socket.data.user?.role !== 'admin') return { error: 'forbidden' };
    await this.captionsService.startRoom(room);
    socket.data.captureRoom = room; //subsequent audio from this socket belong to this room
    return { capturing: room };
  }

  @SubscribeMessage('capture:audio')
  audio(@ConnectedSocket() socket: Socket, @MessageBody() chunk: Buffer) {
    const room = socket.data.captureRoom as string | undefined;
    if (room && socket.data.user?.role === 'admin') {
      this.captionsService.sendAudio(room, chunk);
    }
  }

  @SubscribeMessage('caption:stop')
  async stopCapture(@ConnectedSocket() socket: Socket) {
    const room = socket.data.captureRoom as string | undefined;
    if (room) {
      await this.captionsService.stopRoom(room);
      socket.data.captureRoom = undefined;
    }

    return { stopped: room ?? null };
  }
}
