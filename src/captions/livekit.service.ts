import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';

const audioRoom = (room: string) => `audio:${room}`;

@Injectable()
export class LivekitService {
  constructor(private readonly config: ConfigService) {}

  /** Delegate: subscribe-only access to a venue room's audio. */
  listenerToken(room: string, delegateId: string): Promise<string> {
    return this.mint(room, delegateId, {
      canPublish: false,
      canSubscribe: true,
    });
  }

  /** Admin capture device: publish-only. */
  publisherToken(room: string, adminId: string): Promise<string> {
    return this.mint(room, `capture:${adminId}`, {
      canPublish: true,
      canSubscribe: false,
    });
  }

  serverUrl(): string {
    return this.requireConfig('LIVEKIT_URL');
  }

  private mint(
    room: string,
    identity: string,
    grants: { canPublish: boolean; canSubscribe: boolean },
  ): Promise<string> {
    const at = new AccessToken(
      this.requireConfig('LIVEKIT_API_KEY'),
      this.requireConfig('LIVEKIT_API_SECRET'),
      { identity, ttl: '2h' },
    );
    at.addGrant({ room: audioRoom(room), roomJoin: true, ...grants });
    return at.toJwt();
  }

  private requireConfig(key: string): string {
    const value = this.config.get<string>(key);
    if (!value)
      throw new ServiceUnavailableException('Live audio is not configured');
    return value;
  }
}
