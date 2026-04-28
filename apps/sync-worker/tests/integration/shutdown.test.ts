// Graceful-shutdown integration test for the v2 sync engine (spec §12 T7).
//
// The unit test in tests/unit/loop.test.ts mocks the registry and proves
// the loop respects shuttingDown() between chunks. This test exercises
// the same contract against the REAL DB so the
// runSyncToCompletion → releaseToPending path is end-to-end-correct:
// the row goes back to PENDING with claim ownership cleared, the
// progress committed by the last successful chunk is preserved, and
// pageCursor is non-null so a replacement worker resumes mid-run.

import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { productsHandler } from '../../src/handlers/products';
import { runSyncToCompletion } from '../../src/loop';

import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

interface PageOptions {
  totalElements: number;
  page: number;
  contentId: number;
}

function makeTrendyolPage(opts: PageOptions): unknown {
  return {
    totalElements: opts.totalElements,
    totalPages: opts.totalElements,
    page: opts.page,
    size: 1,
    nextPageToken: null,
    content: [
      {
        contentId: opts.contentId,
        productMainId: `pm-${opts.contentId.toString()}`,
        brand: { id: 1, name: 'TestBrand' },
        category: { id: 2, name: 'TestCategory' },
        creationDate: 1777246115403,
        lastModifiedDate: 1777246115403,
        title: `Product ${opts.contentId.toString()}`,
        description: 'desc',
        images: [{ url: `https://cdn.example.com/${opts.contentId.toString()}.jpg` }],
        attributes: [],
        variants: [
          {
            variantId: opts.contentId * 10,
            supplierId: 2738,
            barcode: `bc-${opts.contentId.toString()}`,
            stockCode: `sk-${opts.contentId.toString()}`,
            attributes: [],
            onSale: true,
            deliveryOptions: {
              deliveryDuration: 1,
              isRushDelivery: false,
              fastDeliveryOptions: [],
            },
            stock: { quantity: 5, lastModifiedDate: 0 },
            price: { salePrice: 100, listPrice: 100 },
            vatRate: 20,
            locked: false,
            archived: false,
            blacklisted: false,
          },
        ],
      },
    ],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('graceful shutdown', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shuttingDown=true between chunks → row goes back to PENDING with cursor preserved', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Shutdown Test',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '2738',
        credentials: encryptCredentials({
          supplierId: '2738',
          apiKey: 'test-api-key',
          apiSecret: 'test-api-secret',
        }),
      },
    });

    // 3 pages mocked — we only get past page 0 before the shutdown
    // signal flips and the loop releases the claim.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(makeTrendyolPage({ totalElements: 3, page: 0, contentId: 100 })),
      )
      .mockResolvedValueOnce(
        jsonResponse(makeTrendyolPage({ totalElements: 3, page: 1, contentId: 200 })),
      )
      .mockResolvedValueOnce(
        jsonResponse(makeTrendyolPage({ totalElements: 3, page: 2, contentId: 300 })),
      );

    const claimed = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-shutdown',
        lastTickAt: new Date(),
        attemptCount: 1,
      },
    });

    // shuttingDown returns false on the first poll (chunk 0 runs and
    // ticks), true thereafter — so the loop exits between chunks 0 and
    // 1 without touching the second mocked fetch.
    let calls = 0;
    await runSyncToCompletion(claimed, { PRODUCTS: productsHandler }, () => {
      const wasShuttingDown = calls > 0;
      calls += 1;
      return wasShuttingDown;
    });

    const after = await prisma.syncLog.findUniqueOrThrow({ where: { id: claimed.id } });

    // Row released back to PENDING for a peer worker to reclaim.
    expect(after.status).toBe('PENDING');
    expect(after.claimedAt).toBeNull();
    expect(after.claimedBy).toBeNull();

    // Progress from chunk 0 committed; cursor saved for the next claim.
    expect(after.progressCurrent).toBeGreaterThan(0);
    expect(after.pageCursor).not.toBeNull();

    // Only one Trendyol page should have been fetched.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
