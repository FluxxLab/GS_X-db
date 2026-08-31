import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RealtimeService, Rooms } from '../common/realtime/realtime.service';
import { CreatePitchEntryDto } from './dto/create-pitch-entry.dto';
import { UpdatePitchEntryDto } from './dto/update-pitch-entry.dto';
import { CreatePitchTopicDto } from './dto/create-pitch-topic.dto';
import { UpdatePitchTopicDto } from './dto/update-pitch-topic.dto';
import { PitchEntry } from './entities/pitch-entry.entity';
import {
  PitchTopic,
  TopicTally,
  TopicVoting,
} from './entities/pitch-topic.entity';
import { PitchVote } from './entities/pitch-vote.entity';
import { PitchVoteEvent } from './entities/pitch-vote-event.entities';

@Injectable()
export class VotingService {
  constructor(
    @InjectRepository(PitchEntry)
    private readonly entries: Repository<PitchEntry>,
    @InjectRepository(PitchVote)
    private readonly votes: Repository<PitchVote>,
    @InjectRepository(PitchTopic)
    private readonly topics: Repository<PitchTopic>,
    private readonly realtime: RealtimeService,
    private readonly dataSource: DataSource,
  ) {}

  /* ---------------------------------------------------------------- topics */

  /**
   * Every topic with its pitches and live standing.
   *
   * One call rather than entries-plus-a-tally-each because both clients render
   * the pitchathon grouped by topic: a ballot is only meaningful next to the
   * others on the same ballot.
   */
  async listTopics() {
    const [topics, entries, counts] = await Promise.all([
      this.topics.find({ order: { position: 'ASC', createdAt: 'ASC' } }),
      this.entries.find({ order: { createdAt: 'ASC' } }),
      this.allCounts(),
    ]);

    return topics.map((topic) => {
      const own = entries
        .filter((e) => e.topicId === topic.id)
        .map((e) => ({ ...e, voteCount: counts.get(e.id) ?? 0 }));

      return {
        ...topic,
        entries: own,
        // Ballots cast in this topic. One per delegate, so this is turnout.
        voters: own.reduce((n, e) => n + e.voteCount, 0),
      };
    });
  }

  createTopic(dto: CreatePitchTopicDto): Promise<PitchTopic> {
    return this.topics.save(this.topics.create(dto));
  }

  async updateTopic(id: string, dto: UpdatePitchTopicDto): Promise<PitchTopic> {
    const topic = await this.topics.findOneBy({ id });
    if (!topic) throw new NotFoundException('Topic not found');

    Object.assign(topic, dto);
    const saved = await this.topics.save(topic);
    this.realtime.emitToRoom(Rooms.voting, 'voting:topic-updated', saved);
    return saved;
  }

  /**
   * Opening is a separate act from creating the topic on purpose: the ballot
   * must not accept a vote until every pitch in it has presented, or whoever
   * pitched last is voting into a race that is already decided.
   */
  async openVoting(id: string): Promise<PitchTopic> {
    const topic = await this.topics.findOneBy({ id });
    if (!topic) throw new NotFoundException('Topic not found');
    if (topic.voting === TopicVoting.CLOSED)
      throw new ConflictException('Voting for this topic is already closed');
    if (topic.voting === TopicVoting.OPEN) return topic; // idempotent

    topic.voting = TopicVoting.OPEN;
    const saved = await this.topics.save(topic);
    this.realtime.emitToRoom(Rooms.voting, 'voting:opened', { topicId: id });
    return saved;
  }

  /** Closing is the moment the result becomes a fact. The tally is snapshotted
   *  onto the topic in the same transaction that closes it, so what was
   *  announced stays retrievable no matter what the live query later says. */
  async closeVoting(topicId: string) {
    return this.dataSource.transaction(async (tx) => {
      const topic = await tx.findOne(PitchTopic, {
        where: { id: topicId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!topic) throw new NotFoundException('Topic not found');
      if (topic.voting === TopicVoting.CLOSED) return topic; // idempotent

      topic.voting = TopicVoting.CLOSED;
      topic.result = await this.tally(topicId, tx);
      topic.closedAt = new Date();

      const saved = await tx.save(topic);
      this.realtime.emitToRoom(Rooms.voting, 'voting:closed', saved.result);
      return saved;
    });
  }

  /**
   * Removes the topic, its pitches (FK cascade) and every ballot cast in it.
   * The votes go explicitly rather than by cascade because they hang off the
   * topic id, not off a foreign key to it.
   */
  async removeTopic(id: string): Promise<void> {
    const topic = await this.topics.findOneBy({ id });
    if (!topic) throw new NotFoundException('Topic not found');

    await this.votes.delete({ topicId: id });
    await this.topics.delete({ id });

    this.realtime.emitToRoom(Rooms.voting, 'voting:topic-deleted', {
      topicId: id,
    });
  }

  /* --------------------------------------------------------------- entries */

  async listEntries(): Promise<Array<PitchEntry & { voteCount: number }>> {
    const [entries, counts] = await Promise.all([
      this.entries.find({ order: { createdAt: 'ASC' } }),
      this.allCounts(),
    ]);
    return entries.map((e) => ({ ...e, voteCount: counts.get(e.id) ?? 0 }));
  }

  createEntry(dto: CreatePitchEntryDto): Promise<PitchEntry> {
    return this.entries.save(this.entries.create(dto));
  }

  /**
   * Admin edit. Ballots are untouched - only the entry's own fields change, so
   * correcting a misspelt name mid-event cannot disturb the tally.
   */
  async updateEntry(
    id: string,
    dto: UpdatePitchEntryDto,
  ): Promise<PitchEntry & { voteCount: number }> {
    const entry = await this.entries.findOneBy({ id });
    if (!entry) throw new NotFoundException('Pitch entry not found');

    Object.assign(entry, dto);
    const saved = await this.entries.save(entry);
    const voteCount = await this.votes.countBy({ entryId: id });

    this.realtime.emitToRoom(Rooms.voting, 'voting:entry-updated', {
      ...saved,
      voteCount,
    });
    return { ...saved, voteCount };
  }

  /**
   * Withdrawal. The ballots resting on this entry go with it, which returns
   * those delegates to "not yet voted" in the topic - the alternative is a
   * ballot pointing at a pitch that no longer exists and a delegate who can
   * never re-cast it.
   *
   * The topic's whole tally rides on the event because two numbers changed:
   * this entry's count vanished and the topic's turnout dropped with it.
   */
  async removeEntry(id: string): Promise<void> {
    const entry = await this.entries.findOneBy({ id });
    if (!entry) throw new NotFoundException('Pitch entry not found');

    await this.votes.delete({ entryId: id });
    await this.entries.delete({ id });

    const tally = await this.tally(entry.topicId);
    this.realtime.emitToRoom(Rooms.voting, 'voting:entry-deleted', {
      entryId: id,
      topicId: entry.topicId,
      tally,
    });
  }

  /* ----------------------------------------------------------------- votes */

  async castVote(delegateId: string, entryId: string) {
    const entry = await this.entries.findOne({
      where: { id: entryId },
      relations: { topic: true },
    });
    if (!entry) throw new NotFoundException('Pitch entry not found');
    if (entry.topic.voting !== TopicVoting.OPEN)
      throw new ConflictException('Voting is not open for this topic');

    const tally = await this.dataSource.transaction(async (tx) => {
      const previous = await tx.findOneBy(PitchVote, {
        delegateId,
        topicId: entry.topicId,
      });
      if (previous?.entryId === entryId) return this.tally(entry.topicId, tx); // no-op re-tap

      await tx
        .createQueryBuilder()
        .insert()
        .into(PitchVote)
        .values({ delegateId, topicId: entry.topicId, entryId })
        .orUpdate(['entryId', 'updatedAt'], ['delegateId', 'topicId'])
        .execute();

      await tx.insert(PitchVoteEvent, {
        delegateId,
        topicId: entry.topicId,
        entryId,
        previousEntryId: previous?.entryId ?? null,
      });

      return this.tally(entry.topicId, tx);
    });

    this.realtime.emitToRoom(Rooms.voting, 'voting:tally', tally);
    return tally;
  }

  /**
   * topicId -> the entry this delegate currently has their vote on.
   *
   * A map rather than a list of ids because the client has to render which
   * pitch is selected within each ballot, and a flat list cannot express that.
   */
  async myVotes(delegateId: string): Promise<Record<string, string>> {
    const rows = await this.votes.findBy({ delegateId });
    return Object.fromEntries(rows.map((r) => [r.topicId, r.entryId]));
  }

  /**
   * Most-voted pitches across every topic, for the Overview widget. Not a
   * ranking anyone wins - the winners are per topic, decided on their own
   * ballot - so this is presented as "most votes", never as a leaderboard.
   */
  async topPitches(limit = 5) {
    const all = await this.listEntries();
    return all
      .sort((a, b) => b.voteCount - a.voteCount)
      .slice(0, limit)
      .map(({ voteCount, ...entry }) => ({ entry, voteCount }));
  }

  /* -------------------------------------------------------------- counting */

  /**
   * One topic's full standing, counted from Postgres.
   *
   * Derived rather than incremented because a vote can move: a change lowers
   * one pitch and raises another, and a Redis counter has no correct way to do
   * both atomically with the write. At a few hundred ballots per topic this
   * query is not worth optimising away.
   *
   * Takes the transaction manager so it can be read inside castVote's
   * transaction and see that transaction's own write.
   */
  private async tally(
    topicId: string,
    tx: EntityManager = this.dataSource.manager,
  ): Promise<TopicTally> {
    const rows = await tx
      .createQueryBuilder(PitchVote, 'v')
      .select('v.entryId', 'entryId')
      .addSelect('COUNT(*)::int', 'votes')
      .where('v.topicId = :topicId', { topicId })
      .groupBy('v.entryId')
      .getRawMany<{ entryId: string; votes: number }>();

    return {
      topicId,
      counts: rows,
      voters: rows.reduce((n, r) => n + r.votes, 0),
    };
  }

  /**
   * Every entry's count in a single grouped query. The list endpoints would
   * otherwise fire one count per entry, which is the shape the Redis counter
   * existed to avoid.
   */
  private async allCounts(): Promise<Map<string, number>> {
    const rows = await this.votes
      .createQueryBuilder('v')
      .select('v.entryId', 'entryId')
      .addSelect('COUNT(*)::int', 'votes')
      .groupBy('v.entryId')
      .getRawMany<{ entryId: string; votes: number }>();

    return new Map(rows.map((r) => [r.entryId, r.votes]));
  }
}
