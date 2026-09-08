import { AccessTier } from '../delegate/entities/delegate.entity';
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
   * capture side (admin / capture page)
   *
   * Session admins exist for exactly this: the console shows them the
   * Capture tab and the REST side already issues them a publish token, so
   * the socket has to let them start a room and stream audio too. Checking
   * for the literal 'admin' here was what stopped them.
   */
  private static canCapture(socket: Socket): boolean {
    const role = (socket.data.user as { role?: string } | undefined)?.role;
    return role === AccessTier.ADMIN || role === AccessTier.SESSION_ADMIN;
  }

  @SubscribeMessage('capture:start')
  async startCapture(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: string | { room: string; diarise?: boolean },
  ) {
    if (!CaptionsGateway.canCapture(socket)) return { error: 'forbidden' };

    // Older capture pages send a bare room string, which means diarise.
    const room = typeof body === 'string' ? body : body.room;
    const diarise = typeof body === 'string' ? true : body.diarise !== false;

    await this.captionsService.startRoom(room, diarise);
    socket.data.captureRoom = room; //subsequent audio from this socket belong to this room
    return { capturing: room, diarise };
  }

  @SubscribeMessage('capture:audio')
  audio(@ConnectedSocket() socket: Socket, @MessageBody() chunk: Buffer) {
    const room = socket.data.captureRoom as string | undefined;
    if (room && CaptionsGateway.canCapture(socket)) {
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
