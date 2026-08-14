import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { Rooms } from '../common/realtime/realtime.service';
import { CaptionsService } from './captions.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class CaptionsGateway {
  constructor(private readonly captionsService: CaptionsService) {}

  /**
   * delegate side
   */
  @SubscribeMessage('captions:join')
  join(@ConnectedSocket() socket: Socket, @MessageBody() sessionId: string) {
    socket.join(Rooms.caption(sessionId));
    return { joined: sessionId };
  }

  @SubscribeMessage('captions:leave')
  leave(@ConnectedSocket() socket: Socket, @MessageBody() sessionId: string) {
    socket.leave(Rooms.caption(sessionId));
    return { left: sessionId };
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
