import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { computeDeltaCutoffMs, computeOrdersCutoffMs } from '../../../src/handlers/orders';

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

describe('computeDeltaCutoffMs — periodic delta window', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('cutoff is endDate − SAFETY_NET_HOURS for a store older than the window', () => {
    process.env['SYNC_SAFETY_NET_HOURS'] = '8';
    const endDate = Date.now();
    const oldCreatedAt = new Date(endDate - 90 * MS_PER_DAY);
    const cutoff = computeDeltaCutoffMs({ storeCreatedAt: oldCreatedAt, endDate });
    expect(cutoff).toBe(endDate - 8 * 60 * 60 * 1000);
  });

  it('clamps to store.createdAt when the store is younger than the safety-net window', () => {
    process.env['SYNC_SAFETY_NET_HOURS'] = '8';
    const endDate = Date.now();
    const recentCreatedAt = new Date(endDate - 2 * 60 * 60 * 1000); // 2h < 8h
    const cutoff = computeDeltaCutoffMs({ storeCreatedAt: recentCreatedAt, endDate });
    expect(cutoff).toBe(recentCreatedAt.getTime());
  });
});
