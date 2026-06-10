// handleRunError syncType gate — PR-13 review finding #1 regression.
//
// The skip-bad-page recovery decodes the PRODUCTS page cursor; before
// the gate, a cursorless CLAIMS/SETTLEMENTS run that exhausted retries
// on MARKETPLACE_UNREACHABLE was fed into it, fabricating phantom
// skipped-page entries and resetting attemptCount in a loop instead of
// failing terminally. These tests lock both sides of the gate.

import { prisma } from '@pazarsync/db';
import { MarketplaceUnreachable } from '@pazarsync/sync-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { handleRunError, MAX_ATTEMPTS } from '../../src/run-error';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

async function setupExhaustedRow(syncType: 'CLAIMS' | 'SETTLEMENTS' | 'PRODUCTS'): Promise<string> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const log = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType,
      status: 'RUNNING',
      startedAt: new Date(),
      progressCurrent: 0,
      attemptCount: MAX_ATTEMPTS,
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

    await handleRunError(id, 'CLAIMS', MAX_ATTEMPTS, err);

    const row = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.skippedPages).toBeNull();
    expect(row.errorMessage).toContain('max retries reached');
  });

  it('SETTLEMENTS at MAX_ATTEMPTS on MARKETPLACE_UNREACHABLE fails terminally too', async () => {
    const id = await setupExhaustedRow('SETTLEMENTS');
    const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 0, url: 'http://x' });

    await handleRunError(id, 'SETTLEMENTS', MAX_ATTEMPTS, err);

    const row = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.skippedPages).toBeNull();
  });

  it('PRODUCTS keeps the skip-bad-page recovery (PENDING + skipped page recorded)', async () => {
    const id = await setupExhaustedRow('PRODUCTS');
    const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 502, url: 'http://x' });

    await handleRunError(id, 'PRODUCTS', MAX_ATTEMPTS, err);

    const row = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PENDING');
    expect(row.attemptCount).toBe(0);
    expect(row.skippedPages).not.toBeNull();
  });
});
