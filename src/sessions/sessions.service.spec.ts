import { SessionsService } from './sessions.service';
import { Session, SessionStatus } from './entities/session.entity';

/**
 * The ripple is the one edit that writes rows the operator did not open. A
 * wrong threshold silently leaves half a room's afternoon where it was, and
 * nothing else in the system would report it. These pin down which sessions
 * move and by how much.
 */
describe('SessionsService.update ripple', () => {
  const at = (hhmm: string) => new Date(`2026-09-08T${hhmm}:00+01:00`);
  const iso = (hhmm: string) => `2026-09-08T${hhmm}:00+01:00`;

  const session = (over: Partial<Session>): Session =>
    ({
      id: over.id ?? 'edited',
      title: 'x',
      day: 1,
      room: 'Hestel',
      status: SessionStatus.SCHEDULED,
      speakers: [],
      ...over,
    }) as Session;

  const build = (edited: Session, others: Session[]) => {
    const saved: Session[][] = [];
    let captured: { from?: Date; status?: string } = {};
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockImplementation((_sql: string, params?: any) => {
        captured = { ...captured, ...params };
        return qb;
      }),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            others.filter(
              (s) =>
                s.status !== SessionStatus.COMPLETED &&
                s.startsAt.getTime() > captured.from!.getTime(),
            ),
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
    return { service, saved, realtime, captured: () => captured };
  };

  it('moves every later session in the room by the change in start time', async () => {
    const edited = session({ startsAt: at('09:00'), endsAt: at('10:00') });
    const next = session({
      id: 'next',
      startsAt: at('10:00'),
      endsAt: at('11:00'),
    });
    const { service, saved, realtime } = build(edited, [next]);

    // delayed by half an hour, length kept
    await service.update('edited', {
      startsAt: iso('09:30'),
      endsAt: iso('10:30'),
      shiftFollowing: true,
    });

    expect(saved).toHaveLength(1);
    expect(next.startsAt).toEqual(at('10:30'));
    expect(next.endsAt).toEqual(at('11:30'));
    expect(realtime.emitGlobal).toHaveBeenCalledWith(
      'sessions:shifted',
      expect.objectContaining({
        deltaMinutes: 30,
        sessionIds: ['edited', 'next'],
      }),
    );
  });

  it('still pushes a session that overlapped the edited one', async () => {
    // Pre Registration 09:00-13:00 with Hestel 12:20-13:00 on top of it: a
    // timing error from before the edit. Delaying the first must carry the
    // second along, not skip it for starting before the old end.
    const edited = session({ startsAt: at('09:00'), endsAt: at('13:00') });
    const overlapping = session({
      id: 'next',
      startsAt: at('12:20'),
      endsAt: at('13:00'),
    });
    const { service, saved, captured } = build(edited, [overlapping]);

    await service.update('edited', {
      startsAt: iso('10:00'),
      endsAt: iso('14:00'),
      shiftFollowing: true,
    });

    expect(captured().from).toEqual(at('09:00'));
    expect(saved).toHaveLength(1);
    expect(overlapping.startsAt).toEqual(at('13:20'));
    expect(overlapping.endsAt).toEqual(at('14:00'));
  });

  it('does nothing when only the end time moved', async () => {
    const edited = session({ startsAt: at('09:00'), endsAt: at('10:00') });
    const next = session({
      id: 'next',
      startsAt: at('10:00'),
      endsAt: at('11:00'),
    });
    const { service, saved, realtime } = build(edited, [next]);

    await service.update('edited', {
      startsAt: iso('09:00'),
      endsAt: iso('10:05'),
      shiftFollowing: true,
    });

    expect(saved).toHaveLength(0);
    expect(next.startsAt).toEqual(at('10:00'));
    expect(realtime.emitGlobal).not.toHaveBeenCalled();
  });

  it('does not ripple unless asked', async () => {
    const edited = session({ startsAt: at('09:00'), endsAt: at('10:00') });
    const next = session({
      id: 'next',
      startsAt: at('10:00'),
      endsAt: at('11:00'),
    });
    const { service, saved } = build(edited, [next]);

    await service.update('edited', { startsAt: iso('09:30') });

    expect(saved).toHaveLength(0);
    expect(next.startsAt).toEqual(at('10:00'));
  });
});
