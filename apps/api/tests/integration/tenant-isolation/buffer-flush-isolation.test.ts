import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';
import { getBusinessDateAnchor } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// sync-worker has no package `exports` map (only `main`), so its handlers are
// NOT importable via a subpath like `@pazarsync/sync-worker/handlers/...`. Import
// the handler by relative path (4 levels up to apps/, then into sync-worker).
// The handler has no app-only deps, so running it in the api test process is safe.
import { processPastDayBufferFlush } from '../../../../sync-worker/src/handlers/buffer-promote';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createBufferEntry, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function mappedFor(platformOrderId: string, barcode: string): Prisma.InputJsonValue {
  // GROSS konvansiyon (2026-06-16): buffer mappedOrder JSON brüt (KDV-dahil)
  // alanlar taşır — eski net 84.75 + KDV 15.25 = brüt 100.00.
  return {
    platformOrderId,
    platformOrderNumber: `ord-${platformOrderId}`,
    orderDate: new Date(Date.now() - ONE_DAY_MS).toISOString(),
    status: 'PROCESSING',
    saleGross: '100.00',
    saleVat: '15.25',
    listGross: '100.00',
    sellerDiscountGross: '0',
    promotionDisplays: null,
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    fastDelivery: false,
    micro: false,
    lines: [
      {
        barcode,
        quantity: 1,
        platformLineId: null,
        lineListGross: '100.00',
        lineSaleGross: '100.00',
        lineSellerDiscountGross: '0',
        saleVatRate: '18',
        commissionRate: '15',
        commissionGross: '15.00',
        refundedCommissionGross: '0',
        commissionVatRate: '20',
      },
    ],
  } as unknown as Prisma.InputJsonValue;
}

describe('Tenant isolation — worker buffer flush graduates under the correct org/store', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('two orgs each with a past-day PENDING entry → each graduates under its own org only', async () => {
    const orgA = await createOrganization();
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const pastDay = getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS));
    await createBufferEntry(orgA.id, storeA.id, {
      orderDate: pastDay,
      platformOrderId: 'iso-a',
      status: 'PENDING',
      mappedOrder: mappedFor('iso-a', 'EAN13-ISO-A'),
    });
    await createBufferEntry(orgB.id, storeB.id, {
      orderDate: pastDay,
      platformOrderId: 'iso-b',
      status: 'PENDING',
      mappedOrder: mappedFor('iso-b', 'EAN13-ISO-B'),
    });

    await processPastDayBufferFlush();

    const ordersA = await prisma.order.findMany({ where: { organizationId: orgA.id } });
    const ordersB = await prisma.order.findMany({ where: { organizationId: orgB.id } });
    expect(ordersA).toHaveLength(1);
    expect(ordersA[0]!.storeId).toBe(storeA.id);
    expect(ordersA[0]!.platformOrderId).toBe('iso-a');
    expect(ordersB).toHaveLength(1);
    expect(ordersB[0]!.storeId).toBe(storeB.id);
    expect(ordersB[0]!.platformOrderId).toBe('iso-b');
    // No cross-org leak: org A's order never lands under org B and vice-versa.
    expect(await prisma.livePerformanceBuffer.count()).toBe(0);
  });
});
