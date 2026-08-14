import {
  WebSocketGateway,
  ConnectedSocket,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Rooms } from 'src/common/realtime/realtime.service';
@WebSocketGateway({ cors: { origin: '*' } })
export class VotingGateway {
  @SubscribeMessage('voting:join')
  join(@ConnectedSocket() socket: Socket) {
    socket.join(Rooms.voting);
    return { joined: Rooms.voting };
  }

  @SubscribeMessage('voting:leave')
  leave(@ConnectedSocket() socket: Socket) {
    socket.leave(Rooms.voting);
    return { left: 'voting' };
  }
}
