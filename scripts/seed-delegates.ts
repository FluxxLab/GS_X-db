/**
 * Seed the delegate directory in one go, or purge what was seeded.
 *
 *   pnpm seed:delegates -- --count 120           # insert now
 *   pnpm seed:delegates -- --count 120 --dry-run  # print a sample, touch nothing
 *   pnpm seed:delegates -- --purge                # remove every seeded delegate
 *
 * For a slow trickle that looks like real registrations, set
 * SEED_DELEGATES_TARGET (and optionally SEED_DELEGATES_INTERVAL_MIN) on the
 * API instead - see src/delegate/seed/delegate-seed.service.ts.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import dataSource from '../src/config/data-source';
import { Delegate } from '../src/delegate/entities/delegate.entity';
import { generate } from '../src/delegate/seed/delegate-seed.data';

// ---------------------------------------------------------------- cli
async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const value = (name: string, fallback: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const count = Number(value('count', '100'));

  if (flag('dry-run')) {
    const rows = generate(count);
    console.table(
      rows
        .slice(0, 15)
        .map(({ name, title, organisation, country, accessTier, email }) => ({
          name,
          title,
          organisation,
          country,
          accessTier,
          email,
        })),
    );
    console.log(`${rows.length} delegates generated; nothing written.`);
    return;
  }

  await dataSource.initialize();
  const repo = dataSource.getRepository(Delegate);

  if (flag('purge')) {
    const { affected } = await repo
      .createQueryBuilder()
      .delete()
      .where('"hasChosenPassword" = false')
      .execute();
    console.log(`purged ${affected ?? 0} seeded delegate(s)`);
    await dataSource.destroy();
    return;
  }

  const existing = await repo
    .createQueryBuilder('d')
    .where('d."hasChosenPassword" = false')
    .getCount();
  const rows = generate(count);
  // one unguessable secret for the batch - these accounts are scenery, not logins
  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  const entities = rows.map((r) =>
    repo.create({
      ...r,
      passwordHash,
      hasChosenPassword: false,
      pendingReview: false,
      consentAt: new Date(),
      phone: null,
      avatarUrl: null,
    }),
  );
  await repo.save(entities, { chunk: 50 });
  console.log(
    `inserted ${entities.length} seeded delegate(s); ${existing} were already there. Purge with --purge.`,
  );
  await dataSource.destroy();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
