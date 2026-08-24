import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccessTier, Delegate } from './entities/delegate.entity';

/** Who a delegate is, for reports that group by person rather than by content. */
export interface DelegateProfile {
  name: string;
  organisation: string | null;
  country: string | null;
  tracks: string[];
  interests: string[];
}
import { DataSource, IsNull, Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { AudienceSegment } from 'src/notifications/entities/notification.entity';
import { RegistrationEntry } from './entities/registration-entry.entity';
import { randomBytes } from 'crypto';
import {
  CreateRegistrationEntryDto,
  UpdateRegistrationEntryDto,
} from './dto/create-delegate.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { DelegateDirectoryDto } from './dto/delegate-directory.dto';
import { ListDirectoryDto } from './dto/list-directory.dto';
import { DelegateConnection } from './entities/delegate-connection.entity';
import { DirectMessage } from './entities/direct-message.entity';
import { MessageReaction } from './entities/message-reaction.entity';
import { SendDirectMessageDto } from './dto/send-direct-message.dto';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { StorageService } from '../common/storage/storage.service';

@Injectable()
export class DelegatesService {
  private readonly logger = new Logger(DelegatesService.name);

  constructor(
    @InjectRepository(Delegate)
    private readonly delegateRepository: Repository<Delegate>,
    @InjectRepository(RegistrationEntry)
    private readonly registrationRepository: Repository<RegistrationEntry>,
    @InjectRepository(DelegateConnection)
    private readonly connections: Repository<DelegateConnection>,
    @InjectRepository(DirectMessage)
    private readonly messages: Repository<DirectMessage>,
    @InjectRepository(MessageReaction)
    private readonly reactions: Repository<MessageReaction>,
    private readonly realtime: RealtimeService,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  findByEmailForAuth(email: string): Promise<Delegate | null> {
    return this.delegateRepository
      .createQueryBuilder('delegate')
      .addSelect('delegate.passwordHash')
      .where('delegate.email = :email', { email })
      .getOne();
  }

  findById(id: string): Promise<Delegate | null> {
    return this.delegateRepository.findOneBy({ id });
  }

  searchDelegates(q: string, limit: number): Promise<Delegate[]> {
    return this.delegateRepository
      .createQueryBuilder('d')
      .where(
        'd.name ILIKE :q OR d.organisation ILIKE :q OR d.country ILIKE :q',
        { q: `%${q}%` },
      )
      .take(limit)
      .getMany();
  }

  async idsForSegment(segment: string): Promise<string[]> {
    const qb = this.delegateRepository.createQueryBuilder('d').select(['d.id']);

    switch (segment) {
      case AudienceSegment.ALL:
        break;
      case AudienceSegment.VIP:
        qb.where('d.accessTier IN (:...tiers)', {
          tiers: [AccessTier.VIP, AccessTier.VVIP],
        });
        break;
      case AudienceSegment.PRESS:
        qb.where('d.accessTier = :tier', { tier: AccessTier.PRESS });
        break;
      case AudienceSegment.SPEAKERS:
        qb.where(':tag = ANY(d.tags)', { tag: 'speaker' });
        break;
      case AudienceSegment.VOLUNTEERS:
        qb.where(':tag = ANY(d.tags)', { tag: 'volunteer' });
        break;
    }
    return (await qb.getMany()).map((d) => d.id);
  }

  /**
   * Which segments this delegate belongs to - the inverse of idsForSegment,
   * and deliberately next to it so the two cannot drift. The notification
   * inbox uses this so that what a delegate can read back always matches what
   * they were actually sent.
   */
  async segmentsFor(delegateId: string): Promise<AudienceSegment[]> {
    const segments = [AudienceSegment.ALL];

    const delegate = await this.delegateRepository.findOne({
      where: { id: delegateId },
    });
    if (!delegate) return segments;

    if (
      delegate.accessTier === AccessTier.VIP ||
      delegate.accessTier === AccessTier.VVIP
    )
      segments.push(AudienceSegment.VIP);
    if (delegate.accessTier === AccessTier.PRESS)
      segments.push(AudienceSegment.PRESS);
    if (delegate.tags?.includes('speaker'))
      segments.push(AudienceSegment.SPEAKERS);
    if (delegate.tags?.includes('volunteer'))
      segments.push(AudienceSegment.VOLUNTEERS);

    return segments;
  }

  async segmentStats() {
    const [total, vip, vvip, flagged, press] = await Promise.all([
      this.delegateRepository.count(),
      this.delegateRepository.countBy({ accessTier: AccessTier.VIP }),
      this.delegateRepository.countBy({ accessTier: AccessTier.VVIP }),
      this.delegateRepository.countBy({ flagged: true }),
      this.delegateRepository.countBy({ accessTier: AccessTier.PRESS }),
    ]);
    return { total, vip, vvip, press, flagged };
  }

  /**
   * Unclaimed list entry matching code (priority) or email
   */
  async matchRegistration(
    email: string,
    inviteCode?: string,
  ): Promise<RegistrationEntry | null> {
    if (inviteCode) {
      return this.registrationRepository.findOneBy({
        inviteCode,
        claimedAt: IsNull(),
      });
    }
    return this.registrationRepository.findOneBy({
      email: email.toLocaleLowerCase(),
      claimedAt: IsNull(),
    });
  }

  async createDelegate(input: {
    name: string;
    email: string;
    passwordHash: string;
    accessTier: AccessTier;
    pendingReview: boolean;
    phone: string | null;
    consentAt: Date;
  }): Promise<Delegate> {
    return this.delegateRepository.save(this.delegateRepository.create(input));
  }

  async claimRegistration(entryId: string, delegateId: string): Promise<void> {
    await this.registrationRepository.update(
      { id: entryId, claimedAt: IsNull() },
      { claimedAt: new Date(), claimedByDelegateId: delegateId },
    );
  }

  async addRegistrationEntry(
    dto: CreateRegistrationEntryDto,
  ): Promise<RegistrationEntry> {
    return this.registrationRepository.save(
      this.registrationRepository.create({
        email: dto.email?.toLowerCase() ?? null,
        inviteCode:
          dto.inviteCode ?? randomBytes(4).toString('hex').toUpperCase(),
        name: dto.name ?? null,
        assignedTier: dto.assignedTier ?? AccessTier.STANDARD,
      }),
    );
  }

  listRegistrationEntries(): Promise<RegistrationEntry[]> {
    return this.registrationRepository.find();
  }

  async updateRegistrationEntry(
    id: string,
    dto: UpdateRegistrationEntryDto,
  ): Promise<RegistrationEntry> {
    const entry = await this.registrationRepository.findOneBy({ id });
    if (!entry) throw new NotFoundException('Registration entry not found');

    if (dto.email !== undefined) entry.email = dto.email?.toLowerCase() ?? null;
    if (dto.inviteCode !== undefined) entry.inviteCode = dto.inviteCode;
    if (dto.name !== undefined) entry.name = dto.name;
    if (dto.assignedTier !== undefined) entry.assignedTier = dto.assignedTier;

    return this.registrationRepository.save(entry);
  }

  async deleteRegistrationEntry(id: string): Promise<void> {
    const result = await this.registrationRepository.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException('Registration entry not found');
    }
  }

  async setTier(delegateId: string, tier: AccessTier): Promise<Delegate> {
    const delegate = await this.findById(delegateId);
    if (!delegate) throw new NotFoundException('Delegate not found');
    delegate.accessTier = tier;
    delegate.pendingReview = false;
    return this.delegateRepository.save(delegate);
  }

  async getProfile(id: string): Promise<Delegate> {
    const d = await this.findById(id);
    if (!d) {
      throw new NotFoundException('Delegate not found');
    }
    return d;
  }

  async updateProfile(id: string, dto: UpdateMeDto) {
    const d = await this.getProfile(id);
    if (dto.tracks) {
      d.tracks = dto.tracks;
    }
    if (dto.interests) {
      d.interests = dto.interests;
    }
    if (dto.avatarUrl !== undefined) {
      // stores the S3 key, not a URL - see StorageService.resolveAvatar
      d.avatarUrl = dto.avatarUrl;
    }
    const saved = await this.delegateRepository.save(d);
    return this.withAvatar({ ...saved, avatarUrl: saved.avatarUrl ?? null });
  }

  /**
   * The current delegate, ready to render.
   *
   * Deliberately separate from getProfile: that one returns the entity that
   * updateProfile mutates and saves, so resolving the avatar there would write
   * a presigned URL back into the column and it would expire in the database.
   */
  async profileView(id: string) {
    const d = await this.getProfile(id);
    return this.withAvatar({ ...d, avatarUrl: d.avatarUrl ?? null });
  }

  async exportCsv(): Promise<string> {
    const rows = await this.delegateRepository.find({
      order: { createdAt: 'ASC' },
    });
    const esc = (v: string | number | boolean | null | undefined) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header =
      'name,email,organisation,tier,tracks,interests,consentAt,registeredAt';
    const lines = rows.map((d) =>
      [
        d.name,
        d.email,
        d.organisation,
        d.accessTier,
        d.tracks.join('; '),
        d.interests.join('; '),
        d.consentAt?.toISOString() ?? '',
        d.createdAt.toISOString(),
      ]
        .map(esc)
        .join(','),
    );
    return [header, ...lines].join('\n');
  }

  async namesByIds(
    ids: string[],
  ): Promise<
    Map<
      string,
      { name: string; organisation: string | null; avatarUrl: string | null }
    >
  > {
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.delegateRepository.find({
      where: { id: In(ids) },
      select: { id: true, name: true, organisation: true, avatarUrl: true },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        { name: r.name, organisation: r.organisation, avatarUrl: r.avatarUrl },
      ]),
    );
  }

  /**
   * The onboarding segmentation, for reports that group by who said something
   * rather than what was said.
   *
   * Separate from namesByIds rather than folded into it: that one is on the
   * connections and moderation paths, where pulling two text arrays per row
   * would be paid on every request for data neither screen shows.
   */
  async profilesByIds(ids: string[]): Promise<Map<string, DelegateProfile>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return new Map();
    }

    const rows = await this.delegateRepository.find({
      where: { id: In(unique) },
      select: {
        id: true,
        name: true,
        organisation: true,
        country: true,
        tracks: true,
        interests: true,
      },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          name: r.name,
          organisation: r.organisation,
          country: r.country,
          tracks: r.tracks ?? [],
          interests: r.interests ?? [],
        },
      ]),
    );
  }

  async tagsFor(id: string): Promise<string[]> {
    const d = await this.delegateRepository.findOne({
      where: { id },
      select: { tags: true },
    });
    return d?.tags ?? [];
  }

  listDelegates(q: { search?: string; tier?: AccessTier; track?: string }) {
    const qb = this.delegateRepository.createQueryBuilder('d');
    if (q.tier) qb.andWhere('d.accessTier = :tier', { tier: q.tier });
    if (q.search) {
      qb.andWhere(
        '(d.name ILIKE :s OR d.email ILIKE :s OR d.organisation ILIKE :s)',
        {
          s: `%${q.search}%`,
        },
      );
    }
    if (q.track) qb.andWhere(':track = ANY(d.tracks)', { track: q.track });
    return qb.orderBy('d.createdAt', 'DESC').take(500).getMany();
  }

  /**
   * Swaps a stored avatar key for a signed, time-limited URL.
   *
   * Kept separate from toDirectoryView because that mapper is static (`this:
   * void`) and signing needs the storage service. Signing is local HMAC, so
   * doing it per row costs no network round trip.
   */
  private async withAvatar<T extends { avatarUrl: string | null }>(
    view: T,
  ): Promise<T> {
    return {
      ...view,
      avatarUrl: await this.storage.resolveAvatar(view.avatarUrl),
    };
  }

  private withAvatars<T extends { avatarUrl: string | null }>(
    views: T[],
  ): Promise<T[]> {
    return Promise.all(views.map((v) => this.withAvatar(v)));
  }

  static toDirectoryView(this: void, d: Delegate): DelegateDirectoryDto {
    return {
      id: d.id,
      name: d.name,
      organisation: d.organisation ?? null,
      country: d.country ?? null,
      accessTier: d.accessTier,
      title: d.title ?? null,
      track: d.track ?? null,
      tags: d.tags ?? [],
      tracks: d.tracks ?? [],
      avatarUrl: d.avatarUrl ?? null,
    };
  }

  async listDelegatesPublic(
    query: ListDirectoryDto,
  ): Promise<{ items: DelegateDirectoryDto[]; total: number }> {
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const q = query.q?.trim();

    // Delegates only: admin accounts are staff, not attendees, so they do not
    // belong in the networking list. Delegates awaiting review are included -
    // excluding them left the directory empty at an event where most delegates
    // self-register. Flagged accounts remain hidden.
    const qb = this.delegateRepository
      .createQueryBuilder('d')
      .where('d.flagged = :f', { f: false })
      .andWhere('d.accessTier != :admin', { admin: AccessTier.ADMIN });

    if (q) {
      qb.andWhere(
        '(d.name ILIKE :s OR d.organisation ILIKE :s OR d.country ILIKE :s)',
        { s: `%${q}%` },
      );
    }

    const [rows, total] = await qb
      .orderBy('d.name', 'ASC')
      .limit(limit)
      .offset(offset)
      .getManyAndCount();

    return {
      items: rows.map(DelegatesService.toDirectoryView),
      total,
    };
  }

  // Resolve one delegate for a scanned QR pass or a direct link. Unlike the
  // browsable directory this includes delegates awaiting review: they can already
  // send and receive DMs, so their identity has to render. Flagged delegates stay
  // hidden, and /connect still refuses both cases.
  async findDirectoryEntry(id: string): Promise<DelegateDirectoryDto> {
    const delegate = await this.findById(id);
    if (!delegate || delegate.flagged) {
      throw new NotFoundException('Delegate not found');
    }
    return {
      ...DelegatesService.toDirectoryView(delegate),
      pendingReview: delegate.pendingReview,
    };
  }

  listAdmins(): Promise<Delegate[]> {
    return this.delegateRepository.findBy({ accessTier: AccessTier.ADMIN });
  }

  async setAdmin(
    id: string,
    grant: boolean,
    actingUserId: string,
  ): Promise<Delegate> {
    const delegate = await this.delegateRepository.findOneBy({ id });
    if (!delegate) throw new NotFoundException('Delegate not found');

    if (!grant) {
      // Guard 1: locking yourself out with one click
      if (id === actingUserId) {
        throw new BadRequestException(
          'You cannot revoke your own admin access',
        );
      }
      // Guard 2: locking EVERYONE out — unrecoverable without database access
      const admins = await this.delegateRepository.countBy({
        accessTier: AccessTier.ADMIN,
      });
      if (admins <= 1) {
        throw new BadRequestException('Cannot revoke the last remaining admin');
      }
    }

    delegate.accessTier = grant ? AccessTier.ADMIN : AccessTier.STANDARD;
    return this.delegateRepository.save(delegate);
  }

  static pairKey(a: string, b: string): string {
    return [a, b].sort().join(':');
  }

  async addConnection(
    fromId: string,
    toId: string,
  ): Promise<DelegateConnection> {
    if (fromId === toId) {
      throw new BadRequestException('You cannot connect to yourself');
    }
    const target = await this.findById(toId);
    if (!target) {
      throw new NotFoundException('Target delegate not found');
    }
    // Pending-review delegates are visible in the directory, so connecting to
    // them has to work too; only flagged accounts are refused.
    if (target.flagged) {
      throw new BadRequestException('Cannot connect: delegate is flagged');
    }

    const pairKey = DelegatesService.pairKey(fromId, toId);
    const [aId, bId] = pairKey.split(':');
    const existing = await this.connections.findOneBy({
      fromDelegateId: aId,
      toDelegateId: bId,
    });

    if (existing) {
      existing.mutual = true;
      await this.connections.save(existing);
      this.realtime.emitToRoom(Rooms.network(toId), 'network:updated', {
        type: 'mutual',
        connectionId: existing.id,
      });
      return existing;
    }

    const conn = await this.connections.save(
      this.connections.create({
        fromDelegateId: fromId,
        toDelegateId: toId,
        mutual: false,
      }),
    );
    this.realtime.emitToRoom(Rooms.network(toId), 'network:updated', {
      type: 'new-follower',
      connectionId: conn.id,
      fromDelegateId: fromId,
    });
    return conn;
  }

  async listConnections(
    delegateId: string,
  ): Promise<Array<{ delegate: DelegateDirectoryDto; mutual: boolean }>> {
    const conns = await this.connections
      .createQueryBuilder('c')
      .where('c.fromDelegateId = :id OR c.toDelegateId = :id', {
        id: delegateId,
      })
      .getMany();

    const otherIds: string[] = [];
    for (const c of conns) {
      otherIds.push(
        c.fromDelegateId === delegateId ? c.toDelegateId : c.fromDelegateId,
      );
    }
    const uniqueIds = Array.from(new Set(otherIds));
    if (uniqueIds.length === 0) return [];
    const others = await this.namesByIds(uniqueIds);

    return conns
      .map((c) => {
        const otherId =
          c.fromDelegateId === delegateId ? c.toDelegateId : c.fromDelegateId;
        const other = others.get(otherId);
        if (!other) return null;
        return {
          delegate: {
            id: otherId,
            name: other.name,
            organisation: other.organisation,
            country: null,
            accessTier: AccessTier.STANDARD,
            title: null,
            track: null,
            tags: [],
            tracks: [],
            avatarUrl: other.avatarUrl,
          },
          mutual: c.mutual,
        };
      })
      .filter(Boolean) as Array<{
      delegate: DelegateDirectoryDto;
      mutual: boolean;
    }>;
  }

  async countConnections(delegateId: string): Promise<number> {
    const rows = await this.connections
      .createQueryBuilder('c')
      .where('c.fromDelegateId = :id OR c.toDelegateId = :id', {
        id: delegateId,
      })
      .getCount();
    return rows;
  }

  async sendDirectMessage(
    senderId: string,
    recipientId: string,
    dto: SendDirectMessageDto,
  ): Promise<DirectMessage> {
    if (senderId === recipientId) {
      throw new BadRequestException('You cannot DM yourself');
    }
    const recipient = await this.findById(recipientId);
    if (!recipient) {
      throw new NotFoundException('Recipient delegate not found');
    }
    const body = dto.body.trim();
    if (!body) {
      throw new BadRequestException('Message body cannot be empty');
    }

    const pairKey = DelegatesService.pairKey(senderId, recipientId);

    /**
     * A reply may only quote a message from this same thread. Without this
     * check a caller could pass any message id and have its text rendered
     * inside a conversation it does not belong to - which leaks the contents of
     * other people's DMs into a thread they can read.
     */
    if (dto.replyToId) {
      const parent = await this.messages.findOneBy({ id: dto.replyToId });
      if (!parent || parent.pairKey !== pairKey) {
        throw new BadRequestException('Cannot reply to that message');
      }
    }

    const msg = await this.messages.save(
      this.messages.create({
        pairKey,
        senderId,
        recipientId,
        body,
        readAt: null,
        replyToId: dto.replyToId ?? null,
      }),
    );

    // Deliver to the open thread and to the recipient's personal room, so a
    // delegate who is elsewhere in the app still receives the message.
    this.realtime.emitToRoom(
      [
        Rooms.dm(DelegatesService.pairKey(senderId, recipientId)),
        Rooms.network(recipientId),
      ],
      'dm:new',
      {
        id: msg.id,
        senderId,
        recipientId,
        body,
        createdAt: msg.createdAt,
        replyToId: msg.replyToId,
      },
    );

    this.logger.log(
      `DM sent ${senderId.slice(0, 8)}… → ${recipientId.slice(0, 8)}… (len=${body.length})`,
    );
    return msg;
  }

  /**
   * Adds, changes or clears the caller's reaction on one message.
   *
   * Only the two people in the thread may react - checked against the message's
   * own sender/recipient rather than a connection lookup, so a reaction can
   * never be attached to a conversation the caller is not part of.
   *
   * The emitted event carries the whole reaction set for the message, not a
   * delta. Deltas would need the client to hold a correct prior state, and a
   * client that missed one event while backgrounded would stay wrong forever.
   */
  async reactToMessage(
    callerId: string,
    messageId: string,
    emoji: string | null,
  ) {
    const message = await this.messages.findOneBy({ id: messageId });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== callerId && message.recipientId !== callerId) {
      throw new NotFoundException('Message not found');
    }

    if (emoji === null) {
      await this.reactions.delete({ messageId, delegateId: callerId });
    } else {
      const existing = await this.reactions.findOneBy({
        messageId,
        delegateId: callerId,
      });
      if (existing) {
        await this.reactions.update({ id: existing.id }, { emoji });
      } else {
        await this.reactions.insert({ messageId, delegateId: callerId, emoji });
      }
    }

    const reactions = await this.reactionsFor([messageId]);
    const payload = {
      messageId,
      reactions: reactions.get(messageId) ?? [],
    };
    this.realtime.emitToRoom(
      [
        Rooms.dm(message.pairKey),
        Rooms.network(
          message.senderId === callerId
            ? message.recipientId
            : message.senderId,
        ),
      ],
      'dm:reaction',
      payload,
    );
    return payload;
  }

  /** Reactions grouped by message, in one query rather than one per message. */
  private async reactionsFor(
    messageIds: string[],
  ): Promise<Map<string, { delegateId: string; emoji: string }[]>> {
    const map = new Map<string, { delegateId: string; emoji: string }[]>();
    if (messageIds.length === 0) return map;
    const rows = await this.reactions.find({
      where: { messageId: In(messageIds) },
    });
    for (const r of rows) {
      const list = map.get(r.messageId) ?? [];
      list.push({ delegateId: r.delegateId, emoji: r.emoji });
      map.set(r.messageId, list);
    }
    return map;
  }

  async listThread(
    callerId: string,
    otherId: string,
    limit = 100,
  ): Promise<DirectMessage[]> {
    const pairKey = DelegatesService.pairKey(callerId, otherId);
    const rows = await this.messages
      .createQueryBuilder('m')
      .where('m.pairKey = :p', { p: pairKey })
      .orderBy('m.createdAt', 'ASC')
      .limit(limit)
      .getMany();

    const unreadIds = rows
      .filter((m) => m.recipientId === callerId && !m.readAt)
      .map((m) => m.id);

    if (unreadIds.length > 0) {
      await this.messages
        .createQueryBuilder()
        .update(DirectMessage)
        .set({ readAt: new Date() })
        .whereInIds(unreadIds)
        .execute();
    }

    // Attached rather than joined: a thread is read in one go, and one extra
    // query beats a join that multiplies message rows by reaction rows.
    const reactions = await this.reactionsFor(rows.map((m) => m.id));

    /**
     * Quoted text is resolved from the rows already loaded wherever possible.
     * A reply's parent is nearly always in the same page of the thread, so this
     * usually costs nothing; only a reply to something older needs a lookup.
     */
    const byId = new Map(rows.map((m) => [m.id, m]));
    const missing = rows
      .map((m) => m.replyToId)
      .filter((rid): rid is string => !!rid && !byId.has(rid));
    if (missing.length > 0) {
      const older = await this.messages.findBy({ id: In(missing) });
      for (const m of older) byId.set(m.id, m);
    }

    return rows.map((m) => {
      const parent = m.replyToId ? byId.get(m.replyToId) : undefined;
      return {
        ...m,
        reactions: reactions.get(m.id) ?? [],
        // null when the parent was deleted - the reply still renders, just
        // without a quote. That is why the FK is SET NULL, not CASCADE.
        replyTo: parent
          ? {
              id: parent.id,
              senderId: parent.senderId,
              body: parent.body.slice(0, 140),
            }
          : null,
      };
    });
  }

  // Every thread the caller is part of, newest first: the other delegate, the
  // last message, and how many of theirs are still unread. Without this a
  // delegate can only reach a DM by navigating to the sender's chat by hand,
  // which is impossible if the sender is not in their directory listing.
  async listConversations(callerId: string): Promise<
    Array<{
      delegate: DelegateDirectoryDto;
      lastMessage: { body: string; createdAt: Date; senderId: string };
      unread: number;
    }>
  > {
    const rows = await this.messages
      .createQueryBuilder('m')
      .where('m.senderId = :id OR m.recipientId = :id', { id: callerId })
      .orderBy('m.createdAt', 'DESC')
      .getMany();

    // rows are newest first, so the first row seen for a pair is its last message
    const threads = new Map<
      string,
      { otherId: string; last: DirectMessage; unread: number }
    >();
    for (const m of rows) {
      const otherId = m.senderId === callerId ? m.recipientId : m.senderId;
      const thread = threads.get(m.pairKey) ?? { otherId, last: m, unread: 0 };
      if (m.recipientId === callerId && !m.readAt) thread.unread += 1;
      threads.set(m.pairKey, thread);
    }
    if (threads.size === 0) return [];

    const others = await this.delegateRepository.find({
      where: { id: In(Array.from(threads.values()).map((t) => t.otherId)) },
    });
    const byId = new Map(others.map((d) => [d.id, d]));

    const out: Array<{
      delegate: DelegateDirectoryDto;
      lastMessage: { body: string; createdAt: Date; senderId: string };
      unread: number;
    }> = [];
    const ordered = Array.from(threads.values()).sort(
      (a, b) => b.last.createdAt.getTime() - a.last.createdAt.getTime(),
    );
    for (const t of ordered) {
      const other = byId.get(t.otherId);
      if (!other) continue;
      out.push({
        delegate: DelegatesService.toDirectoryView(other),
        lastMessage: {
          body: t.last.body,
          createdAt: t.last.createdAt,
          senderId: t.last.senderId,
        },
        unread: t.unread,
      });
    }
    return out;
  }

  // A delegate uploads their photo straight to S3 with a one-time signed URL,
  // then saves the returned public URL through PATCH /delegates/me. Keeping the
  // bytes off the API means no multipart handling and no request size limit.
  presignAvatar(contentType: string) {
    return this.storage.presignUpload({
      folder: 'delegate-avatars',
      contentType,
    });
  }

  /**
   * Delete the account and every row that identifies this delegate.
   *
   * Required by both app stores for any app that lets people create an account
   * (Play since 2023, Apple guideline 5.1.1(v)), and the right default under
   * NDPR/GDPR. Runs in one transaction so a partial delete cannot leave an
   * orphaned session or an unreachable message thread.
   *
   * Kept deliberately: security audit events, which are a record of what
   * happened on the platform rather than profile data, and are keyed by action
   * rather than by delegate.
   */
  async deleteAccount(delegateId: string, password: string): Promise<void> {
    // passwordHash is select:false on the entity, so it has to be asked for
    const delegate = await this.delegateRepository
      .createQueryBuilder('d')
      .addSelect('d.passwordHash')
      .where('d.id = :id', { id: delegateId })
      .getOne();
    if (!delegate) throw new NotFoundException('Delegate not found');

    const ok = await bcrypt.compare(password, delegate.passwordHash);
    if (!ok) throw new UnauthorizedException('Password is incorrect');

    // same guard as revoking admin: never let the platform lose its last admin
    if (delegate.accessTier === AccessTier.ADMIN) {
      const admins = await this.delegateRepository.countBy({
        accessTier: AccessTier.ADMIN,
      });
      if (admins <= 1) {
        throw new BadRequestException(
          'Cannot delete the last remaining admin account',
        );
      }
    }

    await this.dataSource.transaction(async (tx) => {
      // sessions and push first, so the account stops being reachable
      await tx.query('DELETE FROM refresh_tokens WHERE "userId" = $1', [
        delegateId,
      ]);
      await tx.query('DELETE FROM device_tokens WHERE "delegateId" = $1', [
        delegateId,
      ]);

      // anything addressed to or from them, in both directions
      await tx.query(
        'DELETE FROM direct_messages WHERE "senderId" = $1 OR "recipientId" = $1',
        [delegateId],
      );
      await tx.query(
        'DELETE FROM delegate_connections WHERE "fromDelegateId" = $1 OR "toDelegateId" = $1',
        [delegateId],
      );

      // their own activity
      await tx.query('DELETE FROM session_comments WHERE "authorId" = $1', [
        delegateId,
      ]);
      await tx.query('DELETE FROM session_bookmarks WHERE "delegateId" = $1', [
        delegateId,
      ]);
      await tx.query('DELETE FROM session_attendance WHERE "delegateId" = $1', [
        delegateId,
      ]);
      await tx.query('DELETE FROM certificates WHERE "delegateId" = $1', [
        delegateId,
      ]);
      await tx.query('DELETE FROM pitch_votes WHERE "delegateId" = $1', [
        delegateId,
      ]);
      await tx.query('DELETE FROM trivia_answers WHERE "delegateId" = $1', [
        delegateId,
      ]);

      // release the invite so the same person can register again later
      await tx.query(
        'UPDATE registration_entries SET "claimedAt" = NULL, "claimedByDelegateId" = NULL WHERE "claimedByDelegateId" = $1',
        [delegateId],
      );

      await tx.query('DELETE FROM delegates WHERE id = $1', [delegateId]);
    });

    this.logger.log(`account deleted ${delegateId.slice(0, 8)}…`);
  }
}
