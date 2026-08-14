import {
  WebSocketGateway,
  ConnectedSocket,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Rooms } from 'src/common/realtime/realtime.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class TriviaGateway {
  @SubscribeMessage('trivia:join')
  join(@ConnectedSocket() socket: Socket) {
    socket.join(Rooms.trivia);
    return { joined: Rooms.trivia };
  }

  @SubscribeMessage('trivia:leave')
  leave(@ConnectedSocket() socket: Socket) {
    socket.leave(Rooms.trivia);
    return { left: 'trivia' };
  }
}
