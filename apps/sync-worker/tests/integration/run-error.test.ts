// handleRunError syncType gate — PR-13 review finding #1 regression.
//
// The skip-bad-page recovery decodes the PRODUCTS page cursor; before
// the gate, a cursorless CLAIMS/SETTLEMENTS run that exhausted retries
// on MARKETPLACE_UNREACHABLE was fed into it, fabricating phantom
// skipped-page entries and resetting attemptCount in a loop instead of
// failing terminally. These tests lock both sides of the gate.
//
// The hourly product syncs (PRODUCTS_DELTA, PRODUCTS_CHANGES) stay outside
// the gate on purpose: the next tick reruns them, and for PRODUCTS_CHANGES a
// FAILED run never moves the date window (the anchor reads COMPLETED runs
// only), so skipping a page would move the window past unwritten changes.

import { prisma } from '@pazarsync/db';
import type { SyncType } from '@pazarsync/db';
import {
  MarketplaceUnreachable,
  MAX_SYNC_ATTEMPTS,
  type ProductsChangesCursor,
} from '@pazarsync/sync-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleRunError } from '../../src/run-error';

const WORKER_ID = 'worker-test';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

const MS_PER_HOUR = 60 * 60 * 1000;

// A claimed row of `syncType`, by default at the attempt cap with no cursor.
async function setupExhaustedRow(
  syncType: SyncType,
  opts?: { attemptCount?: number; pageCursor?: ProductsChangesCursor },
): Promise<string> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  // RUNNING + claimed by WORKER_ID: handleRunError's terminal writes
  // (fail / recordSkippedPageAndContinue) are lease-fenced on this exact
  // claim, so the row must be held by the worker driving the error.
  const log = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType,
      status: 'RUNNING',
      startedAt: new Date(),
      claimedAt: new Date(),
      claimedBy: WORKER_ID,
      lastTickAt: new Date(),
      progressCurrent: 0,
      attemptCount: opts?.attemptCount ?? MAX_SYNC_ATTEMPTS,
      ...(opts?.pageCursor !== undefined ? { pageCursor: opts.pageCursor } : {}),
    },
  });
  return log.id;
}

describe('handleRunError — skip-bad-page syncType gate', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('CLAIMS at MAX_ATTEMPTS on MARKETPLACE_UNREACHABLE fails terminally — no phantom skipped pages', async () => {
    const id = await setupExhaustedRow('CLAIMS');
    const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 0, url: 'http://x' });

    await handleRunError(id, 'CLAIMS', MAX_SYNC_ATTEMPTS, err, WORKER_ID);

    const row = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.skippedPages).toBeNull();
    expect(row.errorMessage).toContain('max retries reached');
  });

  it('SETTLEMENTS at MAX_ATTEMPTS on MARKETPLACE_UNREACHABLE fails terminally too', async () => {
    const id = await setupExhaustedRow('SETTLEMENTS');
    const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 0, url: 'http://x' });

    await handleRunError(id, 'SETTLEMENTS', MAX_SYNC_ATTEMPTS, err, WORKER_ID);

    const row = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.skippedPages).toBeNull();
  });

  it('PRODUCTS keeps the skip-bad-page recovery (PENDING + skipped page recorded)', async () => {
    const id = await setupExhaustedRow('PRODUCTS');
    const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 502, url: 'http://x' });

    await handleRunError(id, 'PRODUCTS', MAX_SYNC_ATTEMPTS, err, WORKER_ID);

    const row = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PENDING');
    expect(row.attemptCount).toBe(0);
    expect(row.skippedPages).not.toBeNull();
  });

  it.each<SyncType>(['PRODUCTS_DELTA', 'PRODUCTS_CHANGES'])(
    '%s at MAX_ATTEMPTS on MARKETPLACE_UNREACHABLE fails terminally (no skip-bad-page recovery)',
    async (syncType) => {
      const id = await setupExhaustedRow(syncType);
      const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 502, url: 'http://x' });

      await handleRunError(id, syncType, MAX_SYNC_ATTEMPTS, err, WORKER_ID);

      const row = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('FAILED');
      expect(row.skippedPages).toBeNull();
      expect(row.errorMessage).toContain('max retries reached');
    },
  );

  it('PRODUCTS_CHANGES below MAX_ATTEMPTS retries and keeps its stored window cursor', async () => {
    const windowEnd = Date.now();
    const pageCursor: ProductsChangesCursor = {
      phase: 'CONTENT_MODIFIED_DATE',
      page: 1,
      windowStart: windowEnd - MS_PER_HOUR,
      windowEnd,
    };
    const id = await setupExhaustedRow('PRODUCTS_CHANGES', { attemptCount: 1, pageCursor });
    const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 502, url: 'http://x' });

    await handleRunError(id, 'PRODUCTS_CHANGES', 1, err, WORKER_ID);

    const row = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED_RETRYABLE');
    expect(row.pageCursor).toEqual(pageCursor);
    expect(row.skippedPages).toBeNull();
  });
});
