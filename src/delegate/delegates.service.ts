import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccessTier, Delegate } from './entities/delegate.entity';
import { IsNull, Repository, In } from 'typeorm';

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
import { SendDirectMessageDto } from './dto/send-direct-message.dto';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';

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
    private readonly realtime: RealtimeService,
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

  async segmentStats() {
    const [total, vip, vvip, flagged, press] = await Promise.all([
      this.delegateRepository.count(),
      this.delegateRepository.countBy({ accessTier: AccessTier.VIP }),
      this.delegateRepository.countBy({ accessTier: AccessTier.VVIP }),
      this.delegateRepository.countBy({ flagged: true }),
      this.delegateRepository.countBy({ flagged: true }),
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
    return this.delegateRepository.save(d);
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
  ): Promise<Map<string, { name: string; organisation: string | null }>> {
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.delegateRepository.find({
      where: { id: In(ids) },
      select: { id: true, name: true, organisation: true },
    });
    return new Map(
      rows.map((r) => [r.id, { name: r.name, organisation: r.organisation }]),
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
    };
  }

  async listDelegatesPublic(
    query: ListDirectoryDto,
  ): Promise<{ items: DelegateDirectoryDto[]; total: number }> {
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const q = query.q?.trim();

    const qb = this.delegateRepository
      .createQueryBuilder('d')
      .where('d.flagged = :f', { f: false })
      .andWhere('d.pendingReview = :pr', { pr: false });

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
    if (target.flagged || target.pendingReview) {
      throw new BadRequestException(
        'Cannot connect: delegate is pending review or flagged',
      );
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

    const msg = await this.messages.save(
      this.messages.create({
        pairKey: DelegatesService.pairKey(senderId, recipientId),
        senderId,
        recipientId,
        body,
        readAt: null,
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
      },
    );

    this.logger.log(
      `DM sent ${senderId.slice(0, 8)}… → ${recipientId.slice(0, 8)}… (len=${body.length})`,
    );
    return msg;
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
    return rows;
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
}
