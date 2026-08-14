import {
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { Rooms } from '../common/realtime/realtime.service';
import { DelegatesService } from '../delegate/delegates.service';

const ALL_SEGMENTS = ['all', 'vip', 'press', 'speakers', 'volunteers'];

@WebSocketGateway({ cors: { origin: '*' } })
export class NotificationsGateway {
  constructor(private readonly delegatesService: DelegatesService) {}

  @SubscribeMessage('notifications:join')
  async join(@ConnectedSocket() socket: Socket) {
    const user = socket.data.user as { id: string; role: string } | undefined;
    if (!user) return { error: 'unauthorized' };

    // membership is DERIVED from identity — never from a client payload
    const segments = ['all'];
    if (user.role === 'vip' || user.role === 'vvip') segments.push('vip');
    if (user.role === 'press') segments.push('press');

    const tags = await this.delegatesService.tagsFor(user.id);
    if (tags.includes('speaker')) segments.push('speakers');
    if (tags.includes('volunteer')) segments.push('volunteers');

    for (const s of segments) socket.join(Rooms.notifications(s));
    return { joined: segments };
  }

  @SubscribeMessage('notifications:leave')
  leave(@ConnectedSocket() socket: Socket) {
    for (const s of ALL_SEGMENTS) socket.leave(Rooms.notifications(s));
    return { left: true };
  }
}
