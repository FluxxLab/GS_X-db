import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RealtimeService } from '../common/realtime/realtime.service';
import { PitchEntry } from './entities/pitch-entry.entity';
import { PitchTopic, TopicVoting } from './entities/pitch-topic.entity';
import { PitchVote } from './entities/pitch-vote.entity';
import { VotingService } from './voting.service';

/**
 * Two rules that fail silently if they regress: a topic nobody has opened must
 * not leave the API at all, and a pitch holding votes must not move ballot.
 * Neither throws when it breaks - one returns extra data, the other corrupts a
 * tally - so nothing but a test reports them.
 */
describe('VotingService withholding rules', () => {
  const topic = (id: string, voting: TopicVoting): PitchTopic =>
    ({
      id,
      name: `topic-${id}`,
      position: 0,
      voting,
      result: null,
      closedAt: null,
      createdAt: new Date(),
    }) as PitchTopic;

  const entry = (id: string, topicId: string): PitchEntry =>
    ({ id, topicId, innovatorName: `pitch-${id}` }) as PitchEntry;

  let service: VotingService;
  let entries: { find: jest.Mock; findOneBy: jest.Mock; save: jest.Mock };
  let topics: { find: jest.Mock; findOneBy: jest.Mock; save: jest.Mock };
  let votes: { countBy: jest.Mock; find: jest.Mock; createQueryBuilder: jest.Mock };
  let realtime: { emitToRoom: jest.Mock };
  let tx: {
    findOne: jest.Mock;
    findOneBy: jest.Mock;
    countBy: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    entries = { find: jest.fn(), findOneBy: jest.fn(), save: jest.fn() };
    topics = { find: jest.fn(), findOneBy: jest.fn(), save: jest.fn() };
    votes = {
      countBy: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };
    realtime = { emitToRoom: jest.fn() };
    tx = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      countBy: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (row: unknown) => row),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        VotingService,
        { provide: getRepositoryToken(PitchEntry), useValue: entries },
        { provide: getRepositoryToken(PitchTopic), useValue: topics },
        { provide: getRepositoryToken(PitchVote), useValue: votes },
        { provide: RealtimeService, useValue: realtime },
        {
          provide: DataSource,
          useValue: {
            manager: {},
            transaction: (cb: (m: typeof tx) => unknown) => cb(tx),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(VotingService);
    // allCounts() is private and hits the query builder; the standings are not
    // what these tests are about.
    jest
      .spyOn(service as unknown as { allCounts: () => Promise<Map<string, number>> }, 'allCounts')
      .mockResolvedValue(new Map());
  });

  describe('listTopics', () => {
    beforeEach(() => {
      topics.find.mockResolvedValue([
        topic('open-1', TopicVoting.OPEN),
        topic('pending-1', TopicVoting.PENDING),
        topic('closed-1', TopicVoting.CLOSED),
      ]);
      entries.find.mockResolvedValue([
        entry('e-open', 'open-1'),
        entry('e-pending', 'pending-1'),
      ]);
    });

    it('withholds a pending topic entirely from a delegate', async () => {
      const result = await service.listTopics();

      expect(result.map((t) => t.id)).toEqual(['open-1', 'closed-1']);
      // not the name, not the pitches, not the count
      expect(JSON.stringify(result)).not.toContain('pending-1');
      expect(JSON.stringify(result)).not.toContain('e-pending');
    });

    it('gives admin every topic, since admin curates them', async () => {
      const result = await service.listTopics(true);
      expect(result.map((t) => t.id)).toEqual(['open-1', 'pending-1', 'closed-1']);
    });
  });

  describe('listEntries', () => {
    it('drops pitches whose ballot has not opened', async () => {
      entries.find.mockResolvedValue([
        entry('e-open', 'open-1'),
        entry('e-pending', 'pending-1'),
      ]);
      topics.find.mockResolvedValue([topic('pending-1', TopicVoting.PENDING)]);

      const result = await service.listEntries();

      expect(result.map((e) => e.id)).toEqual(['e-open']);
    });

    it('keeps them for admin', async () => {
      entries.find.mockResolvedValue([
        entry('e-open', 'open-1'),
        entry('e-pending', 'pending-1'),
      ]);

      const result = await service.listEntries(true);

      expect(result.map((e) => e.id)).toEqual(['e-open', 'e-pending']);
      // the pending-topic lookup is skipped entirely for admin
      expect(topics.find).not.toHaveBeenCalled();
    });
  });

  describe('updateEntry', () => {
    it('refuses to move a pitch that already holds votes', async () => {
      tx.findOne.mockResolvedValue(entry('e1', 'topic-a'));
      tx.findOneBy.mockResolvedValue(topic('topic-b', TopicVoting.PENDING));
      tx.countBy.mockResolvedValue(3);

      await expect(
        service.updateEntry('e1', { topicId: 'topic-b' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(tx.save).not.toHaveBeenCalled();
    });

    it('takes a write lock when moving, so a vote cannot land mid-check', async () => {
      tx.findOne.mockResolvedValue(entry('e1', 'topic-a'));
      tx.findOneBy.mockResolvedValue(topic('topic-b', TopicVoting.PENDING));

      await service.updateEntry('e1', { topicId: 'topic-b' });

      expect(tx.findOne).toHaveBeenCalledWith(
        PitchEntry,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
    });

    it('allows an unvoted pitch to be assigned to a topic', async () => {
      tx.findOne.mockResolvedValue(entry('e1', 'topic-a'));
      tx.findOneBy.mockResolvedValue(topic('topic-b', TopicVoting.PENDING));

      const saved = await service.updateEntry('e1', { topicId: 'topic-b' });

      expect(saved.topicId).toBe('topic-b');
    });

    it('does not broadcast a pitch whose ballot is still pending', async () => {
      tx.findOne.mockResolvedValue(entry('e1', 'topic-a'));
      tx.findOneBy.mockResolvedValue(topic('topic-b', TopicVoting.PENDING));
      topics.findOneBy.mockResolvedValue(topic('topic-b', TopicVoting.PENDING));

      await service.updateEntry('e1', { topicId: 'topic-b' });

      expect(realtime.emitToRoom).not.toHaveBeenCalled();
    });

    it('broadcasts an edit once the ballot is open', async () => {
      tx.findOneBy.mockResolvedValue(entry('e1', 'topic-a'));
      topics.findOneBy.mockResolvedValue(topic('topic-a', TopicVoting.OPEN));

      await service.updateEntry('e1', { innovatorName: 'Corrected Name' });

      expect(realtime.emitToRoom).toHaveBeenCalledWith(
        'voting',
        'voting:entry-updated',
        expect.objectContaining({ innovatorName: 'Corrected Name' }),
      );
    });

    it('skips the lock for an edit that is not a move', async () => {
      tx.findOneBy.mockResolvedValue(entry('e1', 'topic-a'));
      topics.findOneBy.mockResolvedValue(topic('topic-a', TopicVoting.OPEN));

      await service.updateEntry('e1', { innovatorName: 'Corrected Name' });

      expect(tx.findOne).not.toHaveBeenCalled();
    });
  });
});
