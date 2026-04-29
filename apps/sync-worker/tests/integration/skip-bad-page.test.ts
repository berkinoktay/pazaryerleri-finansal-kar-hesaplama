// Skip-bad-page recovery integration test.
//
// The user-visible bug: a single Trendyol page returning a deterministic
// 5xx (real-world: a corrupted seller record at a specific catalog
// offset) used to terminate the whole sync at half-completion. After
// MAX_ATTEMPTS the handler now advances past the bad page instead of
// terminally failing — this test locks in that transition.
//
// We don't drive the full retry loop here (5 attempts × exponential
// backoff = ~17 minutes of real time); the unit-level concern is that
// `advanceCursorPastBadPage` reads the row, computes the next page,
// stamps a skip entry, and returns the row to PENDING with diagnostic
// fields populated. The worker's `handleRunError` invokes this only
// when the outer loop has exhausted retries — that branch is exercised
// by `index.ts`'s logic and the live sync-worker; here we prove the
// state machine converges to the documented post-condition.
//
// Spec ref: docs/integrations/trendyol/7-trendyol-marketplace-
// entegrasyonu/urun-entegrasyonlari-v2.md (page-based pagination
// contract); plan: /Users/berkin/.claude/plans/async-weaving-cerf.md.

import { prisma } from '@pazarsync/db';
import { MarketplaceUnreachable } from '@pazarsync/sync-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { advanceCursorPastBadPage } from '../../src/skip-bad-page';

import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

describe('advanceCursorPastBadPage', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  async function setupExhaustedRow(opts: {
    cursor: unknown;
    progressCurrent: number;
    progressTotal: number;
  }): Promise<string> {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const row = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'FAILED_RETRYABLE',
        startedAt: new Date(),
        attemptCount: 5,
        progressCurrent: opts.progressCurrent,
        progressTotal: opts.progressTotal,
        pageCursor: opts.cursor as never,
        errorCode: 'MARKETPLACE_UNREACHABLE',
        errorMessage: 'Marketplace unreachable (500) — upstream issue',
        nextAttemptAt: new Date(Date.now() + 30_000),
      },
    });
    return row.id;
  }

  it('advances cursor and records skip for a page-cursor row stuck at page 25', async () => {
    const id = await setupExhaustedRow({
      cursor: { kind: 'page', n: 25 },
      progressCurrent: 2500,
      progressTotal: 5624,
    });

    // Simulate the error the worker layer just caught from the
    // marketplace package — meta carries the diagnostic surface
    // captured in `fetchOnce` at retry-exhaustion.
    const err = new MarketplaceUnreachable('TRENDYOL', {
      httpStatus: 500,
      url: 'https://apigw.trendyol.com/integration/product/sellers/2738/products/approved?size=100&page=25',
      xRequestId: 'trendyol-req-abc',
      responseBodySnippet: '{"errors":[{"code":"INTERNAL_SERVER_ERROR"}]}',
    });

    const advanced = await advanceCursorPastBadPage(id, err);

    expect(advanced).toBe(true);

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('PENDING');
    expect(after.attemptCount).toBe(0);
    expect(after.pageCursor).toEqual({ kind: 'page', n: 26 });
    // Worker projects the next page's start as a progress estimate; the
    // first successful tick on page 26 will overwrite this with the
    // ground-truth count from Trendyol.
    expect(after.progressCurrent).toBe(2600);
    expect(after.errorCode).toBeNull();
    expect(after.claimedAt).toBeNull();

    // Skip record must carry the diagnostic surface verbatim — that's
    // what makes correlation with Trendyol via X-Request-ID possible.
    const skipped = after.skippedPages as Array<Record<string, unknown>>;
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      page: 25,
      errorCode: 'MARKETPLACE_UNREACHABLE',
      httpStatus: 500,
      xRequestId: 'trendyol-req-abc',
      responseBodySnippet: '{"errors":[{"code":"INTERNAL_SERVER_ERROR"}]}',
    });
    expect(typeof skipped[0]?.['attemptedAt']).toBe('string');
  });

  it('returns false when the cursor is token-shaped with no fallback (past 10k cap)', async () => {
    const id = await setupExhaustedRow({
      cursor: { kind: 'token', token: 'opaque-trendyol-token' },
      progressCurrent: 12_500,
      progressTotal: 30_000,
    });

    const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 502 });

    const advanced = await advanceCursorPastBadPage(id, err);

    // We can't synthesize a "next page" from a token cursor — the worker
    // should fall through to terminal FAIL.
    expect(advanced).toBe(false);

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    // No state change expected — the caller (handleRunError) is the one
    // that calls fail() when this returns false.
    expect(after.status).toBe('FAILED_RETRYABLE');
    expect(after.skippedPages).toBeNull();
  });

  it('returns false when the next page would cross the 10k cap and there is no token', async () => {
    // page=99 ⇒ next would be page=100 which * size=100 = 10000 ≥ cap.
    // Without a token to switch to, advance is impossible.
    const id = await setupExhaustedRow({
      cursor: { kind: 'page', n: 99 },
      progressCurrent: 9_900,
      progressTotal: 10_000,
    });

    const err = new MarketplaceUnreachable('TRENDYOL', { httpStatus: 500 });

    const advanced = await advanceCursorPastBadPage(id, err);

    expect(advanced).toBe(false);

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('FAILED_RETRYABLE');
    expect(after.skippedPages).toBeNull();
  });
});
