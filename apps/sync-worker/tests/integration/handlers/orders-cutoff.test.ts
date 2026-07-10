import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { computeOrdersCutoffMs } from '../../../src/handlers/orders';

import { ensureDbReachable, truncateAll } from '../../../../api/tests/helpers/db';
import { createOrganization, createStore } from '../../../../api/tests/helpers/factories';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ORIGINAL_ENV = process.env;

describe('computeOrdersCutoffMs — forward-only window (PR-A)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    await truncateAll();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('cutoff is store.createdAt when SYNC_HISTORICAL_BACKFILL_DAYS=0', async () => {
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '0';
    const org = await createOrganization();
    const store = await createStore(org.id);

    const cutoff = computeOrdersCutoffMs({
      storeCreatedAt: store.createdAt,
      endDate: Date.now(),
    });

    expect(cutoff).toBe(store.createdAt.getTime());
  });

  it('cutoff clamped to store.createdAt even when env requests 90 days back', async () => {
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '90';
    const org = await createOrganization();
    const store = await createStore(org.id);

    const endDate = Date.now();
    const requestedStart = endDate - 90 * MS_PER_DAY;
    const cutoff = computeOrdersCutoffMs({ storeCreatedAt: store.createdAt, endDate });

    // Store just created → createdAt is far newer than 90d ago → it wins.
    expect(cutoff).toBe(store.createdAt.getTime());
    expect(cutoff).toBeGreaterThan(requestedStart);
  });

  it('cutoff falls back to env window when store is older than the backfill', () => {
    // store.createdAt is an argument, not a DB read — a 120d-old date suffices.
    process.env['SYNC_HISTORICAL_BACKFILL_DAYS'] = '30';
    const oldCreatedAt = new Date(Date.now() - 120 * MS_PER_DAY);
    const endDate = Date.now();
    const expected = endDate - 30 * MS_PER_DAY;
    const cutoff = computeOrdersCutoffMs({ storeCreatedAt: oldCreatedAt, endDate });

    // Env window (30d) is newer than the 120d-old store → env window wins.
    expect(cutoff).toBe(expected);
  });
});

// computeDeltaCutoffMs is a pure function (no DB) — its self-healing delta
// window cases live in the fast unit suite: tests/unit/handlers/orders-cutoff.test.ts.
