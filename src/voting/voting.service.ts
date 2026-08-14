import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { REDIS } from '../common/redis/redis.module';
import { CreatePitchEntryDto } from './dto/create-pitch-entry.dto';
import { PitchEntry } from './entities/pitch-entry.entity';
import { PitchVote } from './entities/pitch-vote.entity';

const voteKey = (entryId: string) => `votes:${entryId}`;

@Injectable()
export class VotingService {
  constructor(
    @InjectRepository(PitchEntry)
    private readonly entries: Repository<PitchEntry>,
    @InjectRepository(PitchVote)
    private readonly votes: Repository<PitchVote>,
    @Inject(REDIS)
    private readonly redis: Redis,
    private readonly realtime: RealtimeService,
  ) {}

  async listEntries(): Promise<Array<PitchEntry & { voteCount: number }>> {
    const entries = await this.entries.find({ order: { createdAt: 'ASC' } });
    const counts = await Promise.all(entries.map((e) => this.voteCount(e.id)));
    return entries.map((e, i) => ({ ...e, voteCount: counts[i] }));
  }

  async castVote(
    delegateId: string,
    entryId: string,
  ): Promise<{ voteCount: number; counted: boolean }> {
    const entry = await this.entries.findOneBy({ id: entryId });
    if (!entry) throw new NotFoundException('Pitch entry not found');

    const result = await this.votes
      .createQueryBuilder()
      .insert()
      .values({ delegateId, entryId })
      .orIgnore() //unique constraint = one vote per delegate per entry
      .execute();

    const counted = result.identifiers.length > 0; //false when it was a duplicate
    let voteCount: number;

    if (counted) {
      await this.ensureCounter(entryId);
      voteCount = await this.redis.incr(voteKey(entryId)); // hot path is 0(1)
      this.realtime.emitToRoom(Rooms.voting, 'voting:tally', {
        entryId,
        voteCount,
      });
    } else {
      voteCount = await this.voteCount(entryId);
    }

    return { voteCount, counted };
  }

  async leaderboard(
    limit: number = 10,
  ): Promise<Array<{ entry: PitchEntry; voteCount: number }>> {
    const all = await this.listEntries();
    return all
      .sort((a, b) => b.voteCount - a.voteCount)
      .slice(0, limit)
      .map(({ voteCount, ...entry }) => ({
        entry: entry,
        voteCount,
      }));
  }

  async myVotes(delegateId: string): Promise<string[]> {
    const rows = await this.votes.findBy({ delegateId });
    return rows.map((r) => r.entryId);
  }

  createEntry(dto: CreatePitchEntryDto): Promise<PitchEntry> {
    return this.entries.save(this.entries.create(dto));
  }

  private async voteCount(entryId: string): Promise<number> {
    const cached = await this.redis.get(voteKey(entryId));
    if (cached !== null) return Number(cached);
    return this.ensureCounter(entryId);
  }

  /**
   * Initialize the Redis counter from Postgres exacltly once (cold cache/ restart)
   */
  private async ensureCounter(entryId: string): Promise<number> {
    const key = voteKey(entryId);
    const existing = await this.redis.get(key);
    if (existing !== null) return Number(existing);

    if (existing !== null) return Number(existing);

    const dbCount = await this.votes.countBy({ entryId }); // cold part only
    await this.redis.set(key, dbCount, 'NX' as never);
    return dbCount;
  }

  topPitches(limit = 5) {
    return this.leaderboard(limit);
  }
}