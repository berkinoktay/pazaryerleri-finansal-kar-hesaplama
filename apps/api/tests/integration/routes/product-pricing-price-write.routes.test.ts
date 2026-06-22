// Integration tests for POST .../product-pricing/price — the Trendyol price
// write. This is the system's first write-direction marketplace call, so the
// tests must NEVER hit Trendyol: the global fetch is stubbed to intercept the
// `/prices` (submit → batchId) and `/check-status` (poll → SUCCESS/FAILED)
// endpoints while passing every other request (Supabase auth) through to the
// real fetch.
//
// Covered:
//   - OWNER submits a valid variant → adapter SUCCESS → 200, DB salePrice
//     updated, PriceChangeLog SUCCESS.
//   - MEMBER role → 403 (only OWNER/ADMIN may write), no DB change, no log.
//   - adapter item FAILED → 422 MARKETPLACE_WRITE_FAILED, log FAILED, DB
//     salePrice unchanged.

import type { MemberRole } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { _resetRateLimitStoreForTests } from '@/middleware/rate-limit.middleware';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createMemberStoreAccess,
  createOrganization,
} from '../../helpers/factories';

const app = createApp();

const CREDENTIALS = {
  platform: 'TRENDYOL' as const,
  supplierId: '99999',
  apiKey: 'price-write-api-key',
  apiSecret: 'price-write-api-secret',
};

const BATCH_ID = '57a7229a-e345-4232-88ac-f4169b864293';

interface BatchStatusItem {
  requestItem: { barcode: string; buyingPrice: number; rrp?: number };
  status: string;
  failureReasons: string[];
}

/**
 * Stubs global.fetch so Trendyol `/prices` returns a fixed batchId and
 * `/check-status` returns a COMPLETED batch with the supplied items. Every
 * non-Trendyol request (Supabase auth) goes to the real fetch — auth tokens are
 * verified against the live local Supabase.
 */
function mockTrendyolPriceBatch(items: BatchStatusItem[]): void {
  const realFetch = global.fetch.bind(global);
  vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/prices')) {
      return new Response(JSON.stringify({ batchId: BATCH_ID }), { status: 200 });
    }
    if (url.includes('/check-status')) {
      return new Response(
        JSON.stringify({
          batchId: BATCH_ID,
          batchType: 'PriceUpdate',
          status: 'COMPLETED',
          items,
          creationDate: 1529734317090,
          lastModification: 1529734653403,
          itemCount: items.length,
        }),
        { status: 200 },
      );
    }
    return realFetch(input, init);
  });
}

interface PriceWriteCtx {
  accessToken: string;
  orgId: string;
  storeId: string;
  variantId: string;
  barcode: string;
}

/** Org + member (role) + store with REAL encrypted creds + one variant. */
async function setupStoreWithVariant(role: MemberRole): Promise<PriceWriteCtx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  const member = await createMembership(org.id, user.id, role);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Price Write Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'price-write-test',
      credentials: encryptCredentials(CREDENTIALS),
    },
  });
  // MEMBER/VIEWER need an explicit store grant to pass requireStoreAccess (gate 3),
  // so the 403 they receive is the OWNER/ADMIN role gate — the behavior under
  // test — not the upstream "ungranted store is 404" non-disclosure.
  if (role === 'MEMBER' || role === 'VIEWER') {
    await createMemberStoreAccess(org.id, member.id, store.id);
  }
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 9001n,
      productMainId: 'pm-9001',
      title: 'Price Write Product',
    },
  });
  const barcode = 'BC-PRICE-0001';
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 90010n,
      barcode,
      stockCode: 'STK-PRICE-0001',
      salePrice: new Decimal('500.00'),
      listPrice: new Decimal('600.00'),
      vatRate: 20,
    },
  });
  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    variantId: variant.id,
    barcode,
  };
}

function priceWritePath(orgId: string, storeId: string): string {
  return `/v1/organizations/${orgId}/stores/${storeId}/product-pricing/price`;
}

describe('POST /v1/organizations/:orgId/stores/:storeId/product-pricing/price', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    _resetRateLimitStoreForTests();
    vi.stubEnv('TRENDYOL_PROD_BASE_URL', 'https://apigw.trendyol.com');
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', 'https://stageapigw.trendyol.com');
    vi.stubEnv('TRENDYOL_INTEGRATOR_UA_SUFFIX', 'SelfIntegration');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('OWNER + valid variant + adapter SUCCESS → 200, DB salePrice updated, log SUCCESS', async () => {
    const ctx = await setupStoreWithVariant('OWNER');
    mockTrendyolPriceBatch([
      {
        requestItem: { barcode: ctx.barcode, buyingPrice: 750, rrp: 750 },
        status: 'SUCCESS',
        failureReasons: [],
      },
    ]);

    const res = await app.request(priceWritePath(ctx.orgId, ctx.storeId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(ctx.accessToken) },
      body: JSON.stringify({ variantId: ctx.variantId, salePrice: '750.00' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; newSalePrice: string; batchId: string };
    expect(body.status).toBe('SUCCESS');
    expect(body.newSalePrice).toBe('750.00');
    expect(body.batchId).toBe(BATCH_ID);

    // DB sale price updated to the new value; listPrice raised to >= sale (750 > 600).
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: ctx.variantId } });
    expect(variant.salePrice.toString()).toBe('750');
    expect(variant.listPrice.toString()).toBe('750');

    // Audit log SUCCESS with the old/new prices + batchId.
    const log = await prisma.priceChangeLog.findFirstOrThrow({
      where: { variantId: ctx.variantId },
    });
    expect(log.status).toBe('SUCCESS');
    expect(log.oldSalePrice.toString()).toBe('500');
    expect(log.newSalePrice.toString()).toBe('750');
    expect(log.trendyolBatchId).toBe(BATCH_ID);
    expect(log.barcode).toBe(ctx.barcode);
  });

  it.each<MemberRole>(['MEMBER', 'VIEWER'])(
    'role %s → 403 FORBIDDEN, no DB change, no audit log',
    async (role) => {
      const ctx = await setupStoreWithVariant(role);
      mockTrendyolPriceBatch([
        {
          requestItem: { barcode: ctx.barcode, buyingPrice: 750 },
          status: 'SUCCESS',
          failureReasons: [],
        },
      ]);

      const res = await app.request(priceWritePath(ctx.orgId, ctx.storeId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: bearer(ctx.accessToken) },
        body: JSON.stringify({ variantId: ctx.variantId, salePrice: '750.00' }),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('FORBIDDEN');

      // The gate runs before the write — sale price untouched, no audit row.
      const variant = await prisma.productVariant.findUniqueOrThrow({
        where: { id: ctx.variantId },
      });
      expect(variant.salePrice.toString()).toBe('500');
      const logCount = await prisma.priceChangeLog.count({ where: { variantId: ctx.variantId } });
      expect(logCount).toBe(0);
    },
  );

  it('adapter item FAILED → 422 MARKETPLACE_WRITE_FAILED, log FAILED, DB salePrice unchanged', async () => {
    const ctx = await setupStoreWithVariant('OWNER');
    mockTrendyolPriceBatch([
      {
        requestItem: { barcode: ctx.barcode, buyingPrice: 750 },
        status: 'FAILED',
        failureReasons: ['PRICE_ALREADY_UPDATED_TODAY'],
      },
    ]);

    const res = await app.request(priceWritePath(ctx.orgId, ctx.storeId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer(ctx.accessToken) },
      body: JSON.stringify({ variantId: ctx.variantId, salePrice: '750.00' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; meta?: { errorCode?: string } };
    expect(body.code).toBe('MARKETPLACE_WRITE_FAILED');
    expect(body.meta?.errorCode).toBe('PRICE_ALREADY_UPDATED_TODAY');

    // DB sale price unchanged — write-back only happens on confirmed SUCCESS.
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: ctx.variantId } });
    expect(variant.salePrice.toString()).toBe('500');

    // Audit row recorded the failure with the vendor error code + batchId.
    const log = await prisma.priceChangeLog.findFirstOrThrow({
      where: { variantId: ctx.variantId },
    });
    expect(log.status).toBe('FAILED');
    expect(log.errorCode).toBe('PRICE_ALREADY_UPDATED_TODAY');
    expect(log.trendyolBatchId).toBe(BATCH_ID);
  });
});
