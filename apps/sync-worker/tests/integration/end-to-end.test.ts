// End-to-end integration test for the v2 sync engine.
//
// Drives the full PENDING → claim → chunk loop → COMPLETED pipeline
// against a real DB with a mocked Trendyol response. Proves the whole
// system works as one — every other test in this package covers a
// single layer (claim, watchdog, products handler) in isolation.
//
// Spec §12 implicitly requires it; the original implementation plan
// (PR-4) listed this test by name but it was deferred. Closing the gap
// here as part of the v2 sync-engine completion (see
// docs/plans/2026-04-28-sync-engine-completion-execution.md PR #4).

import { prisma } from '@pazarsync/db';
import { encryptCredentials, tryClaimNext } from '@pazarsync/sync-core';
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

describe('sync engine end-to-end', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PENDING → claim → 2-page sync → COMPLETED with products upserted', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'E2E Store',
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

    // 1. API trigger: insert PENDING row (mirrors what acquireSlot does
    //    inside the route handler). The trigger.enqueued log fires here
    //    in production; the test bypasses the API and writes the row
    //    directly because we're exercising the worker path.
    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    // 2. Mock Trendyol: 2 pages × 1 product. The handler advances the
    //    cursor to {kind:'page', n:1} after page 0 and signals 'done'
    //    when the second fetch returns content for the second product.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(makeTrendyolPage({ totalElements: 2, page: 0, contentId: 100 })),
      )
      .mockResolvedValueOnce(
        jsonResponse(makeTrendyolPage({ totalElements: 2, page: 1, contentId: 200 })),
      );

    // 3. Worker claims the row (this is what tryClaimNext does inside
    //    the worker's poll-and-claim loop).
    const claimed = await tryClaimNext('worker-e2e');
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('RUNNING');

    // 4. Drive the chunk loop to completion. shuttingDown=false so the
    //    loop exits only when the handler signals 'done'.
    if (claimed === null) throw new Error('claim failed');
    await runSyncToCompletion(claimed, { PRODUCTS: productsHandler }, () => false);

    // 5. Final state: COMPLETED, both products upserted, exactly two
    //    Trendyol page fetches issued.
    const final = await prisma.syncLog.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(final.status).toBe('COMPLETED');
    expect(final.recordsProcessed).toBe(2);

    const products = await prisma.product.findMany({ where: { storeId: store.id } });
    expect(products).toHaveLength(2);
    const titles = products.map((p) => p.title).sort();
    expect(titles).toEqual(['Product 100', 'Product 200']);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
