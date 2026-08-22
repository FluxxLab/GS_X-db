import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';

/**
 * LiveKit room name for a venue's audio.
 *
 * Normalised, because the two callers reach this from opposite directions: a
 * publisher token is minted from whatever room string the capture operator
 * typed, while a listener token is minted from the room stored on the session.
 * `findLiveInRoom` already matches those loosely (LOWER/TRIM), so without the
 * same normalisation here " Main Hall " and "Main Hall" mint tokens for two
 * different LiveKit rooms: the delegate joins an empty one and hears silence,
 * with nothing logged anywhere to explain it.
 */
const audioRoom = (room: string) => `audio:${room.trim().toLowerCase()}`;

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
