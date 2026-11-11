// pg-cron-setup.sql contract test.
//
// pg_cron cannot run inside CI (apply-policies skips scheduling when CI=true),
// so this suite covers the cron layer the other way around:
//
//   1. STATIC  — the file defines exactly the expected (job name, schedule)
//      set, so a renamed/dropped/retimed job is a visible diff here, not a
//      silent production change.
//   2. DYNAMIC — the queue fan-out commands are extracted from the file and
//      executed VERBATIM against the real DB: per-ACTIVE-store enqueue, the
//      NOT EXISTS in-flight dedupe, and re-enqueue after completion. This is
//      the exact SQL pg_cron runs in dev/prod (composition-root coverage —
//      handler-level tests cannot catch a broken fan-out query).
//   3. GATE - sync-products-changes-hourly also requires a COMPLETED full
//      PRODUCTS scan for the store; its own describe pins that EXISTS gate
//      (never, other types only, failed-only, in-flight, completed, per store).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@pazarsync/db';
import type { SyncLog, SyncStatus, SyncType } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CRON_SQL = readFileSync(
  path.resolve(__dirname, '../../../../supabase/sql/pg-cron-setup.sql'),
  'utf8',
);

interface CronJobDef {
  name: string;
  schedule: string;
  command: string;
}

function parseCronJobs(sql: string): CronJobDef[] {
  const jobs: CronJobDef[] = [];
  const re = /SELECT cron\.schedule\(\s*'([^']+)',\s*'([^']+)',\s*\$\$([\s\S]*?)\$\$\s*\);/g;
  for (const match of sql.matchAll(re)) {
    const [, name, schedule, command] = match;
    if (name === undefined || schedule === undefined || command === undefined) {
      throw new Error('unreachable: regex groups are non-optional');
    }
    jobs.push({ name, schedule, command });
  }
  return jobs;
}

const JOBS = parseCronJobs(CRON_SQL);

function commandOf(jobName: string): string {
  const job = JOBS.find((j) => j.name === jobName);
  if (job === undefined) {
    throw new Error(`pg-cron-setup.sql does not define job '${jobName}'`);
  }
  return job.command;
}

/** Seeds a sync_logs row of the given type and state straight into the table. */
async function seedRun(
  organizationId: string,
  storeId: string,
  syncType: SyncType,
  status: SyncStatus,
): Promise<SyncLog> {
  const isTerminal = status === 'COMPLETED' || status === 'FAILED';
  return prisma.syncLog.create({
    data: {
      organizationId,
      storeId,
      syncType,
      status,
      startedAt: new Date(),
      completedAt: isTerminal ? new Date() : null,
    },
  });
}

/** Seeds a full PRODUCTS scan row in the given state. */
function seedFullScan(
  organizationId: string,
  storeId: string,
  status: SyncStatus,
): Promise<SyncLog> {
  return seedRun(organizationId, storeId, 'PRODUCTS', status);
}

async function seedCompletedFullScans(
  organizationId: string,
  storeIds: readonly string[],
): Promise<void> {
  for (const storeId of storeIds) {
    await seedFullScan(organizationId, storeId, 'COMPLETED');
  }
}

interface FanoutJob {
  jobName: string;
  syncType: SyncType;
  /**
   * Seeds whatever the job's gate needs before the first tick, for every store
   * the test creates (the DISABLED one included, so only the ACTIVE filter
   * keeps it out).
   */
  arrange?: (organizationId: string, storeIds: readonly string[]) => Promise<void>;
}

/** The queue fan-out jobs — each INSERTs PENDING sync_logs per ACTIVE store. */
const FANOUT_JOBS: readonly FanoutJob[] = [
  { jobName: 'sync-orders-delta', syncType: 'ORDERS' },
  { jobName: 'sync-products-daily', syncType: 'PRODUCTS' },
  { jobName: 'sync-products-delta-hourly', syncType: 'PRODUCTS_DELTA' },
  {
    jobName: 'sync-products-changes-hourly',
    syncType: 'PRODUCTS_CHANGES',
    // Gated on a COMPLETED full scan; the gate has its own describe below.
    arrange: seedCompletedFullScans,
  },
  { jobName: 'sync-settlements-6h', syncType: 'SETTLEMENTS' },
  { jobName: 'sync-claims-6h', syncType: 'CLAIMS' },
];

describe('pg-cron-setup.sql — schedule contract (static)', () => {
  it('defines exactly the expected job set with the expected cron expressions', () => {
    const byName = new Map(JOBS.map((j) => [j.name, j.schedule]));
    expect(byName).toEqual(
      new Map([
        ['sync-orders-delta', '0 * * * *'], // saat başı güvenlik ağı (webhook birincil)
        ['sync-products-daily', '0 0 * * *'], // 03:00 İstanbul, günlük katalog
        ['sync-products-delta-hourly', '15 * * * *'], // saat başı :15 hafif stok+fiyat yürüyüşü
        ['sync-products-changes-hourly', '45 * * * *'], // hourly :45 date-window walk (new products, status/metadata)
        ['sync-settlements-6h', '30 */6 * * *'],
        ['sync-claims-6h', '45 */6 * * *'], // :45 — settlements ile çakışmasın
        ['live-performance-buffer-daily-reset', '0 21 * * *'], // 00:00 İstanbul
      ]),
    );
  });

  it('every fan-out command carries the ACTIVE filter and the in-flight dedupe guard', () => {
    for (const { jobName } of FANOUT_JOBS) {
      const command = commandOf(jobName);
      expect(command).toContain("s.status = 'ACTIVE'");
      expect(command).toContain('NOT EXISTS');
      expect(command).toContain("'PENDING', 'RUNNING', 'FAILED_RETRYABLE'");
    }
  });
});

describe('pg-cron-setup.sql — fan-out SQL executed verbatim (dynamic)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it.each(FANOUT_JOBS)(
    '$jobName enqueues one PENDING $syncType row per ACTIVE store, dedupes in-flight, re-enqueues after completion',
    async ({ jobName, syncType, arrange }) => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const active = await createStore(org.id);
      const disabled = await createStore(org.id, { status: 'DISABLED', name: 'Disabled Store' });
      await arrange?.(org.id, [active.id, disabled.id]);

      const command = commandOf(jobName);

      // Tick 1 — only the ACTIVE store gets a PENDING row.
      await prisma.$executeRawUnsafe(command);
      const afterFirst = await prisma.syncLog.findMany({ where: { syncType } });
      expect(afterFirst).toHaveLength(1);
      const first = afterFirst[0];
      if (first === undefined) throw new Error('unreachable');
      expect(first.storeId).toBe(active.id);
      expect(first.organizationId).toBe(org.id);
      expect(first.status).toBe('PENDING');
      // The raw INSERT never names trigger_source, so the column default applies.
      expect(first.triggerSource).toBe('CRON');

      // Tick 2 while in-flight — the NOT EXISTS guard skips the store.
      await prisma.$executeRawUnsafe(command);
      expect(await prisma.syncLog.count({ where: { syncType } })).toBe(1);

      // Run finishes → the next tick enqueues again.
      await prisma.syncLog.update({
        where: { id: first.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await prisma.$executeRawUnsafe(command);
      expect(await prisma.syncLog.count({ where: { syncType } })).toBe(2);
    },
  );
});

describe('pg-cron-setup.sql - sync-products-changes-hourly full-scan gate (dynamic)', () => {
  const GATED_JOB = 'sync-products-changes-hourly';

  function countChangesRuns(storeId: string): Promise<number> {
    return prisma.syncLog.count({ where: { storeId, syncType: 'PRODUCTS_CHANGES' } });
  }

  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('enqueues nothing until the store has a COMPLETED full PRODUCTS scan, then enqueues one CRON row and dedupes', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const command = commandOf(GATED_JOB);

    // No PRODUCTS row at all: gated.
    await prisma.$executeRawUnsafe(command);
    expect(await countChangesRuns(store.id)).toBe(0);

    // COMPLETED runs of other types do not count: the ORDERS sync usually
    // finishes during onboarding while the bootstrap full scan still runs,
    // and PRODUCTS_DELTA is not a catalog scan either. Pins the
    // `sync_type = 'PRODUCTS'` predicate.
    await seedRun(org.id, store.id, 'ORDERS', 'COMPLETED');
    await seedRun(org.id, store.id, 'PRODUCTS_DELTA', 'COMPLETED');
    await prisma.$executeRawUnsafe(command);
    expect(await countChangesRuns(store.id)).toBe(0);

    // Only a FAILED full scan: still gated.
    await seedFullScan(org.id, store.id, 'FAILED');
    await prisma.$executeRawUnsafe(command);
    expect(await countChangesRuns(store.id)).toBe(0);

    // A full scan still in flight (the connect-time bootstrap case): still gated.
    const running = await seedFullScan(org.id, store.id, 'RUNNING');
    await prisma.$executeRawUnsafe(command);
    expect(await countChangesRuns(store.id)).toBe(0);

    // The full scan completes: the next tick enqueues exactly one PENDING row.
    await prisma.syncLog.update({
      where: { id: running.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await prisma.$executeRawUnsafe(command);
    const rows = await prisma.syncLog.findMany({ where: { syncType: 'PRODUCTS_CHANGES' } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error('unreachable');
    expect(row.storeId).toBe(store.id);
    expect(row.organizationId).toBe(org.id);
    expect(row.status).toBe('PENDING');
    expect(row.triggerSource).toBe('CRON');

    // Tick again while that run is in flight: the NOT EXISTS guard dedupes.
    await prisma.$executeRawUnsafe(command);
    expect(await countChangesRuns(store.id)).toBe(1);
  });

  it("gates per store: another store's COMPLETED full scan does not unlock this one", async () => {
    const scannedOrg = await createOrganization();
    const scannedStore = await createStore(scannedOrg.id);
    // Same org as the scanned store: a newly connected second store whose
    // bootstrap scan has not completed. Pins the `fs.store_id = s.id`
    // predicate; the org predicate alone would let this store through.
    const sameOrgUnscannedStore = await createStore(scannedOrg.id);
    const otherOrg = await createOrganization();
    const otherOrgUnscannedStore = await createStore(otherOrg.id);
    await seedFullScan(scannedOrg.id, scannedStore.id, 'COMPLETED');

    await prisma.$executeRawUnsafe(commandOf(GATED_JOB));

    const rows = await prisma.syncLog.findMany({ where: { syncType: 'PRODUCTS_CHANGES' } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error('unreachable');
    expect(row.storeId).toBe(scannedStore.id);
    expect(row.organizationId).toBe(scannedOrg.id);
    expect(await countChangesRuns(sameOrgUnscannedStore.id)).toBe(0);
    expect(await countChangesRuns(otherOrgUnscannedStore.id)).toBe(0);
  });
});
