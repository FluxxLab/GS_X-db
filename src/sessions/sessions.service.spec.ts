import { ConflictException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { Session, SessionStatus } from './entities/session.entity';

/**
 * One room holds one session at a time. Clearing the room is the one edit
 * that writes rows the operator did not open, and a wrong rule either leaves
 * two sessions on top of each other or drags half a day for nothing. These
 * pin down what moves, how far, and what is refused.
 */
describe('SessionsService.update room clearing', () => {
  const at = (hhmm: string) => new Date(`2026-09-08T${hhmm}:00+01:00`);
  const iso = (hhmm: string) => `2026-09-08T${hhmm}:00+01:00`;

  const session = (over: Partial<Session>): Session =>
    ({
      id: over.id ?? 'edited',
      title: over.id ?? 'edited',
      day: 1,
      room: 'Hestel',
      status: SessionStatus.SCHEDULED,
      speakers: [],
      ...over,
    }) as Session;

  const build = (edited: Session, others: Session[]) => {
    const saved: Session[][] = [];
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            others
              .filter((s) => s.status !== SessionStatus.COMPLETED)
              .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
          ),
        ),
    };
    const sessions = {
      findOne: jest.fn().mockResolvedValue(edited),
      save: jest.fn().mockImplementation((v: Session | Session[]) => {
        if (Array.isArray(v)) saved.push(v);
        return Promise.resolve(v);
      }),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const realtime = { emitGlobal: jest.fn(), emit: jest.fn() };
    const service = new SessionsService(
      sessions as any,
      { findBy: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      realtime as any,
      {} as any,
    );
    return { service, saved, realtime, sessions };
  };

  it('pushes a later session just far enough to clear the edit', async () => {
    // Pre Registration 12:00-13:00 edited to end 13:30; Hestel 12:25-13:05
    // was already on top of it. Hestel lands at 13:30, keeping its 40 min.
    const edited = session({ startsAt: at('12:00'), endsAt: at('13:00') });
    const next = session({
      id: 'next',
      startsAt: at('12:25'),
      endsAt: at('13:05'),
    });
    const { service, saved, realtime } = build(edited, [next]);

    await service.update('edited', {
      endsAt: iso('13:30'),
      shiftFollowing: true,
    });

    expect(saved).toEqual([[next]]);
    expect(next.startsAt).toEqual(at('13:30'));
    expect(next.endsAt).toEqual(at('14:10'));
    expect(realtime.emitGlobal).toHaveBeenCalledWith(
      'sessions:shifted',
      expect.objectContaining({
        deltaMinutes: 65,
        sessionIds: ['edited', 'next'],
      }),
    );
  });

  it('cascades: a pushed session pushes the one it lands on', async () => {
    const edited = session({ startsAt: at('09:00'), endsAt: at('10:00') });
    const b = session({ id: 'b', startsAt: at('10:00'), endsAt: at('11:00') });
    const c = session({ id: 'c', startsAt: at('11:00'), endsAt: at('12:00') });
    const d = session({ id: 'd', startsAt: at('13:00'), endsAt: at('14:00') });
    const { service, saved } = build(edited, [b, c, d]);

    // delayed by half an hour, length kept
    await service.update('edited', {
      startsAt: iso('09:30'),
      endsAt: iso('10:30'),
      shiftFollowing: true,
    });

    expect(saved[0].map((s) => s.id)).toEqual(['b', 'c']);
    expect(b.startsAt).toEqual(at('10:30'));
    expect(c.startsAt).toEqual(at('11:30'));
    expect(c.endsAt).toEqual(at('12:30'));
    // the gap before d absorbs the delay; d stays put
    expect(d.startsAt).toEqual(at('13:00'));
  });

  it('leaves the room alone when nothing overlaps', async () => {
    const edited = session({ startsAt: at('09:00'), endsAt: at('10:00') });
    const next = session({
      id: 'next',
      startsAt: at('10:30'),
      endsAt: at('11:00'),
    });
    const { service, saved, realtime } = build(edited, [next]);

    await service.update('edited', {
      endsAt: iso('10:15'),
      shiftFollowing: true,
    });

    expect(saved).toHaveLength(0);
    expect(next.startsAt).toEqual(at('10:30'));
    expect(realtime.emitGlobal).not.toHaveBeenCalledWith(
      'sessions:shifted',
      expect.anything(),
    );
    // the plain edit is still announced
    expect(realtime.emitGlobal).toHaveBeenCalledWith('session:updated', {
      sessionId: 'edited',
    });
  });

  it('pushes by default when the flag is not sent', async () => {
    const edited = session({ startsAt: at('09:00'), endsAt: at('10:00') });
    const next = session({
      id: 'next',
      startsAt: at('10:00'),
      endsAt: at('11:00'),
    });
    const { service, saved } = build(edited, [next]);

    await service.update('edited', { endsAt: iso('10:15') });

    expect(saved).toEqual([[next]]);
    expect(next.startsAt).toEqual(at('10:15'));
  });

  it('refuses a collision when told not to push, and writes nothing', async () => {
    const edited = session({ startsAt: at('09:00'), endsAt: at('10:00') });
    const next = session({
      id: 'next',
      startsAt: at('10:00'),
      endsAt: at('11:00'),
    });
    const { service, sessions } = build(edited, [next]);

    await expect(
      service.update('edited', { endsAt: iso('10:15'), shiftFollowing: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sessions.save).not.toHaveBeenCalled();
    expect(next.startsAt).toEqual(at('10:00'));
  });

  it('refuses an edit that starts inside the session before it', async () => {
    const edited = session({ startsAt: at('10:00'), endsAt: at('11:00') });
    const prev = session({
      id: 'prev',
      startsAt: at('09:00'),
      endsAt: at('10:00'),
    });
    const { service, sessions } = build(edited, [prev]);

    await expect(
      service.update('edited', {
        startsAt: iso('09:45'),
        shiftFollowing: true,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(sessions.save).not.toHaveBeenCalled();
  });

  it('does not touch the room when only the title changed', async () => {
    const edited = session({ startsAt: at('09:00'), endsAt: at('10:00') });
    const next = session({
      id: 'next',
      startsAt: at('09:30'),
      endsAt: at('10:30'),
    }); // already overlapping, but this edit is not about time
    const { service, sessions } = build(edited, [next]);

    await service.update('edited', { title: 'renamed' });

    expect(sessions.createQueryBuilder).not.toHaveBeenCalled();
    expect(sessions.save).toHaveBeenCalledTimes(1);
  });
});
