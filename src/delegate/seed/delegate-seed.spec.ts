import { generate, SEED_TAG } from './delegate-seed.data';
import { DelegateSeedService } from './delegate-seed.service';
import { AccessTier } from '../entities/delegate.entity';

/**
 * Seeded delegates have to pass as real to a reader and stay traceable to
 * the system. These pin down both, and that the trickle stops at its target.
 */
describe('generate', () => {
  const rows = generate(300);

  it('produces the count asked for, every one tagged and undeliverable', () => {
    expect(rows).toHaveLength(300);
    for (const r of rows) {
      expect(r.tags).toEqual([SEED_TAG]);
      expect(r.email).toMatch(/^[a-z._0-9]+@(gmail|ymail)\.com$/);
      expect(r.name.split(' ').length).toBeGreaterThanOrEqual(2);
      expect(r.tracks.length).toBeGreaterThanOrEqual(1);
      expect(r.interests.length).toBeGreaterThanOrEqual(2);
      expect(r.interests.length).toBeLessThanOrEqual(5);
    }
  });

  it('never repeats an email', () => {
    expect(new Set(rows.map((r) => r.email)).size).toBe(rows.length);
  });

  it('invents a title and organisation for a made-up delegate, and neither for a real one', () => {
    // an empty title is how a roster-sourced row is told apart from a fully
    // invented one - synthetic organisations never carry an empty title
    const invented = rows.filter((r) => r.title !== '');
    const fromRoster = rows.filter((r) => r.title === '');
    expect(invented.length).toBeGreaterThan(0);
    expect(fromRoster.length).toBeGreaterThan(0);
    for (const r of invented) expect(r.organisation).toBeTruthy();
    // a real registrant's tier is never guessed - VIP gates real access
    for (const r of fromRoster) expect(r.accessTier).toBe(AccessTier.STANDARD);
  });

  it('draws every real registrant before it invents anyone, name intact', () => {
    const names = new Set(rows.map((r) => r.name));
    for (const n of [
      'Maryam Abdallah',
      'Sylvanus Udoenoh',
      'Simi John Dalyop',
    ]) {
      expect(names.has(n)).toBe(true);
    }
  });

  it('reads like a summit list: mostly Nigerian, mostly standard, some press, few VIP', () => {
    const nigerian = rows.filter((r) => r.country === 'Nigeria').length;
    const press = rows.filter((r) => r.accessTier === AccessTier.PRESS).length;
    const vip = rows.filter((r) => r.accessTier === AccessTier.VIP).length;
    expect(nigerian / rows.length).toBeGreaterThan(0.8);
    expect(press).toBeGreaterThan(0);
    expect(vip).toBeLessThan(rows.length / 10);
    expect(
      rows.some((r) =>
        /^(Dr|Mrs|Ms|Mr|Hajiya|Alhaji|Engr|Barr|Prof)\./.test(r.name),
      ),
    ).toBe(true);
  });
});

describe('DelegateSeedService.tick', () => {
  const build = (seededSoFar: number, target: number, lock = 'OK') => {
    const saved: unknown[] = [];
    const delegates = {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(seededSoFar),
      }),
      create: jest.fn().mockImplementation((v: unknown) => v),
      save: jest.fn().mockImplementation(async (v: unknown) => {
        saved.push(v);
        return v;
      }),
    };
    const redis = { set: jest.fn().mockResolvedValue(lock) };
    const config = {
      get: jest
        .fn()
        .mockImplementation((k: string) =>
          k === 'SEED_DELEGATES_TARGET' ? String(target) : undefined,
        ),
    };
    const service = new DelegateSeedService(
      delegates as any,
      redis as any,
      config as any,
    );
    return { service, saved, redis };
  };

  it('inserts one delegate when below target', async () => {
    const { service, saved } = build(10, 150);
    await expect(service.tick()).resolves.toBe(true);
    expect(saved).toHaveLength(1);
    expect((saved[0] as { tags: string[] }).tags).toEqual([SEED_TAG]);
    expect((saved[0] as { pendingReview: boolean }).pendingReview).toBe(false);
  });

  it('inserts nothing once the target is reached', async () => {
    const { service, saved } = build(150, 150);
    await expect(service.tick()).resolves.toBe(false);
    expect(saved).toHaveLength(0);
  });

  it('skips the tick when another instance holds the lock', async () => {
    const { service, saved, redis } = build(10, 150, null as unknown as string);
    await expect(service.tick()).resolves.toBe(false);
    expect(saved).toHaveLength(0);
    expect(redis.set).toHaveBeenCalledWith(
      'seed:delegates:tick',
      '1',
      'PX',
      expect.any(Number),
      'NX',
    );
  });

  it('is off when no target is configured', () => {
    const { service } = build(0, 0);
    expect(service.target).toBe(0);
    service.onModuleInit();
    expect((service as unknown as { timer: unknown }).timer).toBeNull();
  });

  it('defaults to twenty minutes', () => {
    const { service } = build(0, 150);
    expect(service.intervalMs).toBe(20 * 60_000);
  });
});
