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
   *
   * A pending topic is withheld from delegates in full - not its name, not its
   * innovators, not its pitch count. The reveal is the moment voting opens, so
   * it has to be enforced here: filtering in the client would still ship the
   * unopened line-up to every phone, one response body away from being read.
   * Admin curates topics before they open, so admin sees them all.
   */
  async listTopics(includePending = false) {
    const [topics, entries, counts] = await Promise.all([
      this.topics.find({ order: { position: 'ASC', createdAt: 'ASC' } }),
      this.entries.find({ order: { createdAt: 'ASC' } }),
      this.allCounts(),
    ]);

    const visible = includePending
      ? topics
      : topics.filter((t) => t.voting !== TopicVoting.PENDING);

    return visible.map((topic) => {
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
    // The voting room is every delegate, so a pending topic's name cannot go
    // out on it - withholding it from GET /topics and then broadcasting it
    // here would leak the same thing by the other channel. Admin sees the
    // change in this call's own response; it lands for everyone when the
    // ballot opens.
    if (saved.voting !== TopicVoting.PENDING)
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

  /**
   * Flat list of pitches. Carries the same withholding rule as listTopics -
   * a pitch on an unopened ballot is exactly what must not be visible, and
   * this endpoint would otherwise hand it over without the topic wrapper.
   */
  async listEntries(
    includePending = false,
  ): Promise<Array<PitchEntry & { voteCount: number }>> {
    const [entries, counts, pendingTopics] = await Promise.all([
      this.entries.find({ order: { createdAt: 'ASC' } }),
      this.allCounts(),
      includePending
        ? Promise.resolve(null)
        : this.topics.find({
            where: { voting: TopicVoting.PENDING },
            select: { id: true },
          }),
    ]);

    const hidden = pendingTopics && new Set(pendingTopics.map((t) => t.id));
    const visible = hidden
      ? entries.filter((e) => !hidden.has(e.topicId))
      : entries;

    return visible.map((e) => ({ ...e, voteCount: counts.get(e.id) ?? 0 }));
  }

  createEntry(dto: CreatePitchEntryDto): Promise<PitchEntry> {
    return this.entries.save(this.entries.create(dto));
  }

  /**
   * Admin edit, including moving a pitch onto another ballot (dto.topicId) -
   * that is how a pitch gets assigned out of the unassigned bucket.
   *
   * Correcting a name or a description cannot disturb the tally. Moving the
   * pitch can: its ballots are recorded against a topic, so carrying a pitch
   * that already holds votes into another topic would take those votes with it
   * and leave two tallies wrong. A pitch is therefore only movable while no
   * one has voted for it - which is to say, before its ballot opens.
   */
  async updateEntry(
    id: string,
    dto: UpdatePitchEntryDto,
  ): Promise<PitchEntry & { voteCount: number }> {
    const moving = Boolean(dto.topicId);

    // A move is checked and applied under one lock. Counting the votes and
    // then saving as two statements leaves a window: a ballot cast between
    // them passes a check that was already stale, and the vote lands on a
    // pitch that is no longer in the topic it was cast for. An edit that is
    // not a move touches nothing votes depend on, so it skips the lock.
    const { saved, voteCount } = await this.dataSource.transaction(
      async (tx) => {
        const entry = moving
          ? await tx.findOne(PitchEntry, {
              where: { id },
              lock: { mode: 'pessimistic_write' },
            })
          : await tx.findOneBy(PitchEntry, { id });
        if (!entry) throw new NotFoundException('Pitch entry not found');

        if (dto.topicId && dto.topicId !== entry.topicId) {
          const target = await tx.findOneBy(PitchTopic, { id: dto.topicId });
          if (!target) throw new NotFoundException('Target topic not found');

          const cast = await tx.countBy(PitchVote, { entryId: id });
          if (cast > 0)
            throw new ConflictException(
              'This pitch already holds votes and can no longer be moved to another topic',
            );
        }

        Object.assign(entry, dto);
        const row = await tx.save(entry);
        return { saved: row, voteCount: await tx.countBy(PitchVote, { entryId: id }) };
      },
    );

    // Same rule as the topic broadcast: this payload is the pitch itself -
    // innovator, country, description - so it must not reach the voting room
    // while its ballot is unopened. That is precisely what is being withheld.
    const topic = await this.topics.findOneBy({ id: saved.topicId });
    if (topic && topic.voting !== TopicVoting.PENDING)
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
  async topPitches(limit = 5, includePending = false) {
    const all = await this.listEntries(includePending);
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
