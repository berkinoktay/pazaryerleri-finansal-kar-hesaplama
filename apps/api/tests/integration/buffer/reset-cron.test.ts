import { getBusinessDateAnchor } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import { createBufferEntry, createOrganization, createStore } from '../../helpers/factories';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Exercises reset_live_performance_buffer() — the SQL function the 00:00 pg_cron
 * job calls (supabase/sql/pg-cron-setup.sql → supabase/sql/db-functions.sql).
 * pg_cron cannot run on its schedule in CI, so the test invokes the same function
 * directly: cron and test share one source of truth for the DELETE predicate.
 *
 * It also cross-checks that the TS business-date anchor (getBusinessDateAnchor)
 * and the SQL business date ((now() AT TIME ZONE 'Europe/Istanbul')::date) agree
 * on "today" — the cross-layer consistency the timezone centralization guarantees.
 */
async function runReset(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ reset_live_performance_buffer: bigint }>>(
    'SELECT reset_live_performance_buffer()',
  );
  return Number(rows[0]?.reset_live_performance_buffer ?? 0);
}

describe('reset_live_performance_buffer()', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('deletes entries before today and keeps today', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const today = getBusinessDateAnchor();
    const yesterday = getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS));

    const keep = await createBufferEntry(org.id, store.id, {
      orderDate: today,
      platformOrderId: 'keep',
    });
    await createBufferEntry(org.id, store.id, { orderDate: yesterday, platformOrderId: 'drop' });

    const deleted = await runReset();

    expect(deleted).toBe(1);
    const remaining = await prisma.livePerformanceBuffer.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(keep.id);
  });

  it("keeps an entry whose business date is exactly today (strict '<')", async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await createBufferEntry(org.id, store.id, { orderDate: getBusinessDateAnchor() });

    const deleted = await runReset();

    expect(deleted).toBe(0);
    expect(await prisma.livePerformanceBuffer.count()).toBe(1);
  });

  it('purges stale entries across all orgs (system-wide housekeeping, not tenant-scoped)', async () => {
    const orgA = await createOrganization();
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const twoDaysAgo = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    await createBufferEntry(orgA.id, storeA.id, { orderDate: twoDaysAgo });
    await createBufferEntry(orgB.id, storeB.id, { orderDate: twoDaysAgo });

    const deleted = await runReset();

    expect(deleted).toBe(2);
    expect(await prisma.livePerformanceBuffer.count()).toBe(0);
  });

  it('is idempotent — a second run deletes nothing', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS)),
    });

    expect(await runReset()).toBe(1);
    expect(await runReset()).toBe(0);
  });
});
