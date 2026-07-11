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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@pazarsync/db';
import type { SyncType } from '@pazarsync/db';
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

/** The queue fan-out jobs — each INSERTs PENDING sync_logs per ACTIVE store. */
const FANOUT_JOBS: ReadonlyArray<{ jobName: string; syncType: SyncType }> = [
  { jobName: 'sync-orders-delta', syncType: 'ORDERS' },
  { jobName: 'sync-products-daily', syncType: 'PRODUCTS' },
  { jobName: 'sync-products-delta-hourly', syncType: 'PRODUCTS_DELTA' },
  { jobName: 'sync-settlements-6h', syncType: 'SETTLEMENTS' },
  { jobName: 'sync-claims-6h', syncType: 'CLAIMS' },
];

describe('pg-cron-setup.sql — schedule contract (static)', () => {
  it('defines exactly the expected job set with the expected cron expressions', () => {
    const byName = new Map(JOBS.map((j) => [j.name, j.schedule]));
    expect(byName).toEqual(
      new Map([
        ['fx-rates-sync-daily', '0 13 * * 1-5'], // 16:00 İstanbul, hafta içi
        ['sync-orders-delta', '0 * * * *'], // saat başı güvenlik ağı (webhook birincil)
        ['sync-products-daily', '0 0 * * *'], // 03:00 İstanbul, günlük katalog
        ['sync-products-delta-hourly', '15 * * * *'], // saat başı :15 hafif stok+fiyat yürüyüşü
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
    async ({ jobName, syncType }) => {
      const user = await createUserProfile();
      const org = await createOrganization();
      await createMembership(org.id, user.id);
      const active = await createStore(org.id);
      await createStore(org.id, { status: 'DISABLED', name: 'Disabled Store' });

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
