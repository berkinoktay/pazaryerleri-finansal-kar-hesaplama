/**
 * Seller-input final-marker backfill in the governance SQL (same-day edit window,
 * plan PR-1 closing review).
 *
 * The migration 20261123175419_seller_input_history marks every order dated
 * before the deploy day's Istanbul start as final in a one-shot UPDATE. A
 * database that gets the schema through `pnpm db:push` (or `prisma migrate
 * resolve --applied`) never runs that migration, yet apply-policies installs the
 * history triggers, so the day-close pass would treat the whole history as
 * non-final. supabase/sql/triggers.sql therefore runs the same UPDATE, limited to
 * non-final orders, only while trg_log_cost_link_removal does not exist yet.
 *
 * The test simulates the db:push path on this worker's clone: it drops the two
 * history triggers and runs triggers.sql as one multi-statement query, the way
 * packages/db/scripts/apply-policies.ts does. The order dates are set inside the
 * applying transaction from its own instant, so the day boundary can never move
 * between the fixture and the run (no flake around midnight). The file is
 * re-applied after the suite so later files on this clone keep their triggers.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma } from '@pazarsync/db';
import { getBusinessDayRange } from '@pazarsync/utils';

import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import { createOrder, createOrganization, createStore } from '../../helpers/factories';

const here = dirname(fileURLToPath(import.meta.url));
const TRIGGERS_SQL_PATH = resolve(here, '../../../../../supabase/sql/triggers.sql');
const HISTORY_TRIGGER_NAMES = ['trg_log_cost_link_removal', 'trg_log_variant_desi_change'];
const ONE_DAY_MS = 86_400_000;

function triggersSql(): string {
  return readFileSync(TRIGGERS_SQL_PATH, 'utf-8');
}

async function dropHistoryTriggers(): Promise<void> {
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS trg_log_cost_link_removal ON product_variant_cost_profiles`;
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS trg_log_variant_desi_change ON product_variants`;
}

async function historyTriggerCount(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: unknown }>>`
    SELECT count(*)::int AS n
      FROM pg_trigger
     WHERE tgname::text = ANY(${HISTORY_TRIGGER_NAMES}::text[])
       AND NOT tgisinternal
  `;
  const n = rows[0]?.n;
  if (typeof n !== 'number') {
    throw new Error('could not count the history triggers');
  }
  return n;
}

/** The applying transaction's start instant as a UTC wall clock, ms precision. */
async function readTxNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ tx_now: unknown }>>`
    SELECT timezone('utc', now())::timestamp(3) AS tx_now
  `;
  const txNow = rows[0]?.tx_now;
  if (!(txNow instanceof Date)) {
    throw new Error('could not read the transaction instant');
  }
  return txNow;
}

interface BackfillFixture {
  readonly organizationId: string;
  /** Dated 1 ms before the run day's Istanbul start: past, non-final. */
  readonly justBeforeDayStart: string;
  /** Dated three days before the run day's start: past, non-final. */
  readonly daysAgo: string;
  /** Dated exactly at the run day's start: today, non-final. */
  readonly atDayStart: string;
  /** Dated at the run instant: today, non-final. */
  readonly atRunInstant: string;
  /** Dated two days before the run day's start, already final. */
  readonly alreadyFinal: string;
  /** The already-final order's marker; never rewritten. */
  readonly alreadyFinalMarker: Date;
}

async function seedFixture(): Promise<BackfillFixture> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  // Placeholder dates: the applying transaction re-dates every order from its
  // own instant (applyGovernanceSqlWithoutTriggers).
  const justBeforeDayStart = await createOrder(org.id, store.id);
  const daysAgo = await createOrder(org.id, store.id);
  const atDayStart = await createOrder(org.id, store.id);
  const atRunInstant = await createOrder(org.id, store.id);
  const alreadyFinalMarker = new Date(Date.now() - 5 * ONE_DAY_MS);
  const alreadyFinal = await createOrder(org.id, store.id, {
    sellerInputsFinalAt: alreadyFinalMarker,
  });
  return {
    organizationId: org.id,
    justBeforeDayStart: justBeforeDayStart.id,
    daysAgo: daysAgo.id,
    atDayStart: atDayStart.id,
    atRunInstant: atRunInstant.id,
    alreadyFinal: alreadyFinal.id,
    alreadyFinalMarker,
  };
}

/**
 * Drops the two history triggers (a database that never had them), then applies
 * triggers.sql in one transaction whose instant dates the fixture orders. The
 * session time zone is set to Istanbul before the file runs, so a boundary or a
 * stamp that followed the session time zone would show. Returns the instant.
 */
async function applyGovernanceSqlWithoutTriggers(fixture: BackfillFixture): Promise<Date> {
  await dropHistoryTriggers();
  expect(await historyTriggerCount()).toBe(0);
  const sql = triggersSql();
  return prisma.$transaction(async (tx) => {
    const txNow = await readTxNow(tx);
    const dayStart = getBusinessDayRange(txNow).start;
    const dated: ReadonlyArray<readonly [string, Date]> = [
      [fixture.justBeforeDayStart, new Date(dayStart.getTime() - 1)],
      [fixture.daysAgo, new Date(dayStart.getTime() - 3 * ONE_DAY_MS)],
      [fixture.atDayStart, dayStart],
      [fixture.atRunInstant, txNow],
      [fixture.alreadyFinal, new Date(dayStart.getTime() - 2 * ONE_DAY_MS)],
    ];
    for (const [id, orderDate] of dated) {
      await tx.order.update({
        where: { id, organizationId: fixture.organizationId },
        data: { orderDate },
      });
    }
    await tx.$executeRaw`SET LOCAL TIME ZONE 'Europe/Istanbul'`;
    await tx.$executeRawUnsafe(sql);
    return txNow;
  });
}

async function markers(fixture: BackfillFixture): Promise<Map<string, Date | null>> {
  const rows = await prisma.order.findMany({
    where: { organizationId: fixture.organizationId },
    select: { id: true, sellerInputsFinalAt: true },
  });
  return new Map(rows.map((row) => [row.id, row.sellerInputsFinalAt]));
}

describe('triggers.sql: final-marker backfill on the db:push path', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    // A failure between the drop and the re-apply must not leave this clone
    // without the history triggers for the files that run after this one.
    await prisma.$executeRawUnsafe(triggersSql());
  });

  it('makes every past-dated non-final order final at the transaction instant, once', async () => {
    const fixture = await seedFixture();

    const txNow = await applyGovernanceSqlWithoutTriggers(fixture);

    const afterFirst = await markers(fixture);
    // Past-dated, non-final: final at the applying transaction's UTC instant.
    expect(afterFirst.get(fixture.justBeforeDayStart)).toEqual(txNow);
    expect(afterFirst.get(fixture.daysAgo)).toEqual(txNow);
    // Today's orders stay non-final; the day-close pass owns them.
    expect(afterFirst.get(fixture.atDayStart)).toBeNull();
    expect(afterFirst.get(fixture.atRunInstant)).toBeNull();
    // An order the migration already made final keeps its marker.
    expect(afterFirst.get(fixture.alreadyFinal)).toEqual(fixture.alreadyFinalMarker);
    // The file installed the triggers again.
    expect(await historyTriggerCount()).toBe(2);

    // Second run, exactly as apply-policies runs the file, with the triggers in
    // place. A past-dated order that is non-final again (the day-close pass has
    // not reached it) must stay non-final: the backfill is gated on the missing
    // trigger, not only on the NULL marker.
    await prisma.order.update({
      where: { id: fixture.daysAgo, organizationId: fixture.organizationId },
      data: { sellerInputsFinalAt: null },
    });
    await prisma.$executeRawUnsafe(triggersSql());

    const afterSecond = await markers(fixture);
    expect(afterSecond.get(fixture.daysAgo)).toBeNull();
    expect(afterSecond.get(fixture.justBeforeDayStart)).toEqual(txNow);
    expect(afterSecond.get(fixture.atDayStart)).toBeNull();
    expect(afterSecond.get(fixture.atRunInstant)).toBeNull();
    expect(afterSecond.get(fixture.alreadyFinal)).toEqual(fixture.alreadyFinalMarker);
    expect(await historyTriggerCount()).toBe(2);
  });
});
