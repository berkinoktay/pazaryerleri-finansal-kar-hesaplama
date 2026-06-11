// Variant-resolution tick integration tests (variant-recovery PR-2).
//
// Real DB. The vendor side is the ONLY thing mocked (global.fetch spy):
// (1) local catalog match links without any vendor call;
// (2) a missing barcode is fetched from Trendyol with the targeted
//     single-barcode query and lands through the SAME products upsert
//     pipeline, then the line links + cost/profit re-entry fires;
// (3) a barcode the vendor does not know advances attempts + backoff.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';

import { processVariantResolution } from '../../src/handlers/variant-resolution';

import {
  createCostProfile,
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

const SANDBOX_BASE = 'https://stageapigw.trendyol.test';
const SUPPLIER_ID = '2738';

interface BuiltCtx {
  organizationId: string;
  storeId: string;
  orderId: string;
  itemId: string;
}

/** Org + SANDBOX store (real encrypted creds) + order with ONE unresolved item. */
async function buildUnresolvedScenario(barcode: string): Promise<BuiltCtx> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Resolution Test Store',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: SUPPLIER_ID,
      credentials: encryptCredentials({ supplierId: SUPPLIER_ID, apiKey: 'k', apiSecret: 's' }),
      status: 'ACTIVE',
    },
  });

  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: `pkg-${randomUUID().slice(0, 8)}`,
      platformOrderNumber: `ord-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'PROCESSING',
      saleSubtotalNet: new Decimal('100.00'),
      saleVatTotal: new Decimal('20.00'),
    },
  });

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      productVariantId: null,
      barcode,
      platformLineId: BigInt(Math.floor(Math.random() * 1_000_000)),
      quantity: 1,
      unitPrice: new Decimal('120.00'),
      commissionRate: new Decimal('10.00'),
      commissionAmount: new Decimal('12.00'),
      unitPriceNet: new Decimal('100.00'),
      unitVatRate: new Decimal('20.00'),
      unitVatAmount: new Decimal('20.00'),
    },
  });

  return { organizationId: org.id, storeId: store.id, orderId: order.id, itemId: item.id };
}

/** Catalog variant for (storeId, barcode); optionally with an active cost profile. */
async function seedCatalogVariant(
  orgId: string,
  storeId: string,
  barcode: string,
  withCost: boolean,
): Promise<void> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Resolution Catalog Product',
    },
  });
  const costLink = withCost
    ? {
        costProfileLinks: {
          create: {
            organizationId: orgId,
            profileId: (await createCostProfile(orgId, { amount: '40.00' })).id,
          },
        },
      }
    : {};
  await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      ...costLink,
    },
  });
}

/** Real approved-products wire fixture (same shape the full catalog sync maps). */
function approvedProductsResponse(barcode: string, count: number): unknown {
  return {
    totalElements: count,
    totalPages: 1,
    page: 0,
    size: 100,
    nextPageToken: null,
    content: Array.from({ length: count }, (_, i) => ({
      contentId: 700_000 + i,
      productMainId: `pmid-${barcode}`,
      brand: { id: 1, name: 'Brand' },
      category: { id: 1, name: 'Category' },
      creationDate: 1777246115403,
      lastModifiedDate: 1777246115403,
      title: 'Vendor Product',
      description: 'desc',
      images: [{ url: 'https://cdn.example.com/x.jpg' }],
      attributes: [],
      variants: [
        {
          variantId: 7_000_000 + i,
          supplierId: Number(SUPPLIER_ID),
          barcode,
          attributes: [],
          onSale: true,
          deliveryOptions: { deliveryDuration: 1, isRushDelivery: false, fastDeliveryOptions: [] },
          stock: { quantity: 5, lastModifiedDate: 0 },
          price: { salePrice: 100, listPrice: 120 },
          stockCode: `sk-${barcode}`,
          vatRate: 20,
          locked: false,
          archived: false,
          blacklisted: false,
        },
      ],
    })),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('processVariantResolution', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', SANDBOX_BASE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('links an unresolved item from the local catalog (no vendor call) and re-enters cost/profit', async () => {
    const ctx = await buildUnresolvedScenario('BC-LOCAL-1');
    await seedCatalogVariant(ctx.organizationId, ctx.storeId, 'BC-LOCAL-1', true);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('vendor must NOT be called when the local catalog already matches');
    });

    await processVariantResolution();

    expect(fetchSpy).not.toHaveBeenCalled();
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(item.productVariantId).not.toBeNull();
    // Cost re-entry: the linked variant carries an active cost profile.
    expect(item.unitCostSnapshotNet).not.toBeNull();
  });

  it('fetches a missing barcode from the vendor, upserts the catalog row, and links', async () => {
    const ctx = await buildUnresolvedScenario('BC-VENDOR-2');

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith(SANDBOX_BASE) && url.includes('barcode=BC-VENDOR-2')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('BC-VENDOR-2', 1)));
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });

    await processVariantResolution();

    expect(
      await prisma.productVariant.count({
        where: { storeId: ctx.storeId, barcode: 'BC-VENDOR-2' },
      }),
    ).toBe(1);
    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(item.productVariantId).not.toBeNull();
    // Attempts untouched on success — the row leaves the queue by linking.
    expect(item.variantResolutionAttempts).toBe(0);
  });

  it('advances attempts + exponential backoff when the vendor knows no such barcode', async () => {
    const ctx = await buildUnresolvedScenario('BC-GONE-3');

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith(SANDBOX_BASE) && url.includes('barcode=BC-GONE-3')) {
        return Promise.resolve(jsonResponse(approvedProductsResponse('BC-GONE-3', 0)));
      }
      throw new Error(`unexpected fetch in test: ${url}`);
    });

    await processVariantResolution();

    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(item.productVariantId).toBeNull();
    expect(item.variantResolutionAttempts).toBe(1);
    expect(item.nextResolutionAt).not.toBeNull();
    expect(item.nextResolutionAt!.getTime()).toBeGreaterThan(Date.now());

    // A second tick BEFORE the backoff deadline must not touch the row again.
    await processVariantResolution();
    const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: ctx.itemId } });
    expect(after.variantResolutionAttempts).toBe(1);
  });
});
