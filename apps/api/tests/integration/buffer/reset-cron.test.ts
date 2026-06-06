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

  it('deletes a PERMANENT_FAILED past-day entry (un-graduatable safety-net)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const yesterday = getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS));
    await createBufferEntry(org.id, store.id, {
      orderDate: yesterday,
      platformOrderId: 'perm',
      status: 'PERMANENT_FAILED',
    });

    const deleted = await runReset();

    expect(deleted).toBe(1);
    expect(await prisma.livePerformanceBuffer.count()).toBe(0);
  });

  it('KEEPS a PENDING past-day entry (the worker graduates it, cron must not delete)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const entry = await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS)),
      platformOrderId: 'pending-keep',
      status: 'PENDING',
    });

    const deleted = await runReset();

    expect(deleted).toBe(0);
    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(1);
  });

  it('KEEPS a FAILED past-day entry (promote retry owns it, not the cron)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const entry = await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS)),
      platformOrderId: 'failed-keep',
      status: 'FAILED',
    });

    const deleted = await runReset();

    expect(deleted).toBe(0);
    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(1);
  });

  it('KEEPS a PERMANENT_FAILED entry whose business date is today (strict past-day only)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      platformOrderId: 'perm-today',
      status: 'PERMANENT_FAILED',
    });

    const deleted = await runReset();

    expect(deleted).toBe(0);
    expect(await prisma.livePerformanceBuffer.count()).toBe(1);
  });

  it('is idempotent — a second run deletes nothing', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS)),
      platformOrderId: 'perm-idem',
      status: 'PERMANENT_FAILED',
    });

    expect(await runReset()).toBe(1);
    expect(await runReset()).toBe(0);
  });

  it('empty buffer → returns 0, deletes nothing', async () => {
    const org = await createOrganization();
    await createStore(org.id);

    expect(await runReset()).toBe(0);
    expect(await prisma.livePerformanceBuffer.count()).toBe(0);
  });

  it('mixed past-day statuses → deletes only PERMANENT_FAILED, keeps PENDING and FAILED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const pastDay = getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS));
    await createBufferEntry(org.id, store.id, {
      orderDate: pastDay,
      platformOrderId: 'mixed-perm',
      status: 'PERMANENT_FAILED',
    });
    const pending = await createBufferEntry(org.id, store.id, {
      orderDate: pastDay,
      platformOrderId: 'mixed-pending',
      status: 'PENDING',
    });
    const failed = await createBufferEntry(org.id, store.id, {
      orderDate: pastDay,
      platformOrderId: 'mixed-failed',
      status: 'FAILED',
    });

    const deleted = await runReset();

    expect(deleted).toBe(1);
    const remaining = await prisma.livePerformanceBuffer.findMany();
    expect(remaining.map((r) => r.id).sort()).toEqual([failed.id, pending.id].sort());
    expect(remaining.find((r) => r.id === pending.id)?.status).toBe('PENDING');
    expect(remaining.find((r) => r.id === failed.id)?.status).toBe('FAILED');
  });
});
