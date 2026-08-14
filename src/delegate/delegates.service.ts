import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AccessTier, Delegate } from './entities/delegate.entity';
import { IsNull, Repository, In } from 'typeorm';

import { AudienceSegment } from 'src/notifications/entities/notification.entity';
import { RegistrationEntry } from './entities/registration-entry.entity';
import { randomBytes } from 'crypto';
import { CreateRegistrationEntryDto } from './dto/create-delegate.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class DelegatesService {
  constructor(
    @InjectRepository(Delegate)
    private readonly delegateRepository: Repository<Delegate>,
    @InjectRepository(RegistrationEntry)
    private readonly registrationRepository: Repository<RegistrationEntry>,
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
}
