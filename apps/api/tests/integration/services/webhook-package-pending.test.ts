// Integration test: the Trendyol webhook pipeline skips a package Trendyol has
// not created yet (shipmentPackageId 0 — an Awaiting order before the payment
// check). Such a package maps to platformOrderId '0', so intake must skip it
// with no order / buffer write; the webhook event row still gets the normal
// terminal success stamp (processedAt set, processingError null).
//
// Drives `processTrendyolWebhookEvent` from `@pazarsync/webhook-ingest`
// directly (the route's HTTP concerns are out of scope here) against the real
// test DB, mirroring the store/variant setup from buffer-rule.test.ts.

import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import type { TrendyolShipmentPackage } from '@pazarsync/marketplace';
import { processTrendyolWebhookEvent } from '@pazarsync/webhook-ingest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const SUPPLIER_ID = '98765';
const BARCODE = 'EAN13-PENDING-001';

async function setupStore(): Promise<{ orgId: string; storeId: string }> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Package-pending Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: SUPPLIER_ID,
      credentials: encryptCredentials({ supplierId: SUPPLIER_ID, apiKey: 'k', apiSecret: 's' }),
    },
  });

  // Seed the line's variant so the eager catalog repair finds it already in the
  // catalog and never reaches for the vendor.
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${BARCODE}`,
      title: 'Pending Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: BARCODE,
      stockCode: `sk-${BARCODE}`,
      salePrice: '100',
      listPrice: '120',
    },
  });

  return { orgId: org.id, storeId: store.id };
}

// Trendyol stamps shipmentPackageId 0 for an Awaiting order whose package it has
// not created yet. orderDate is a real recent instant so fee resolution lands
// inside the seeded FeeDefinition effective window.
function makePendingPayload(): TrendyolShipmentPackage {
  const orderDate = Date.now();
  return {
    orderNumber: '2147427535',
    shipmentPackageId: 0,
    status: 'Awaiting',
    orderDate,
    lastModifiedDate: orderDate,
    fastDelivery: false,
    micro: false,
    packageGrossAmount: 100,
    packageTotalPrice: 100,
    lines: [
      {
        lineId: 1,
        barcode: BARCODE,
        quantity: 1,
        lineUnitPrice: 100,
        lineGrossAmount: 100,
        vatRate: 20,
        commission: 10,
      },
    ],
  };
}

describe('processTrendyolWebhookEvent — package-pending skip (shipmentPackageId 0)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes no order / buffer row and stamps the webhook event processed with no error', async () => {
    const { orgId, storeId } = await setupStore();
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });

    // Tripwire: the seeded variant means the eager catalog repair never needs
    // the vendor, so any outbound fetch is a regression.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      throw new Error(`vendor must not be called: ${String(input)}`);
    });

    const payload = makePendingPayload();
    const event = await prisma.webhookEvent.create({
      data: {
        organizationId: orgId,
        storeId,
        platform: 'TRENDYOL',
        platformOrderId: String(payload.shipmentPackageId),
        platformStatus: payload.status,
        platformLastModifiedDate: new Date(payload.lastModifiedDate),
        // Audit copy only — a JSON-safe subset keeps the row's rawPayload a valid
        // InputJsonValue (the full DTO carries optional-undefined fields). The test
        // asserts the event's processing stamps, not this payload.
        rawPayload: {
          orderNumber: payload.orderNumber,
          shipmentPackageId: payload.shipmentPackageId,
          status: payload.status,
        },
      },
    });

    await processTrendyolWebhookEvent(store, payload, event.id);

    expect(fetchSpy).not.toHaveBeenCalled();
    // The Awaiting package was skipped — nothing keyed onto platformOrderId '0'.
    expect(await prisma.order.count({ where: { storeId } })).toBe(0);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId } })).toBe(0);

    // The event itself is a terminal success (handled), not an error.
    const stamped = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stamped.processedAt).not.toBeNull();
    expect(stamped.processingError).toBeNull();
  });
});
