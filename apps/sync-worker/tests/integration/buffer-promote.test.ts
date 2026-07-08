import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';
import { getBusinessDateAnchor } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { processBufferPromote, processPastDayBufferFlush } from '../../src/handlers/buffer-promote';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createOrganization,
  createStore,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

const BARCODE = 'EAN13-PROMOTE-001';

/**
 * A MappedOrder-shaped value as stored in buffer.mappedOrder (JSON). Dates are
 * ISO strings (JSON round-trip — upsertOrderWithSnapshot coerces them). With
 * `invalid: true` a line carries a non-numeric lineSaleGross so the upsert's
 * `new Decimal(...)` throws — a deterministic promote failure for the retry path.
 */
function buildMappedOrder(over: {
  platformOrderId: string;
  platformOrderNumber?: string;
  barcode?: string;
  invalid?: boolean;
  fastDeliveryType?: string;
  estimatedDeliveryStartDate?: string;
  estimatedDeliveryEndDate?: string;
  actualShipDate?: string;
  /** ISO string — the marketplace lastModifiedDate carried by the buffer snapshot.
   * Omitted by default so existing rows keep their lastModifiedDate-free shape. */
  lastModifiedDate?: string;
}): Prisma.InputJsonValue {
  const value = {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: over.platformOrderNumber ?? `ord-${over.platformOrderId}`,
    orderDate: new Date().toISOString(),
    ...(over.lastModifiedDate !== undefined && { lastModifiedDate: over.lastModifiedDate }),
    status: 'PROCESSING',
    // GROSS konvansiyon: saleGross (KDV-dahil) = 100; saleVat = 100×18/118 = 15.25.
    saleGross: '100.00',
    saleVat: '15.25',
    listGross: '100.00',
    sellerDiscountGross: '0.00',
    promotionDisplays: null,
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    actualShipDate: over.actualShipDate ?? null,
    fastDelivery: false,
    fastDeliveryType: over.fastDeliveryType ?? null,
    micro: false,
    estimatedDeliveryStartDate: over.estimatedDeliveryStartDate ?? null,
    estimatedDeliveryEndDate: over.estimatedDeliveryEndDate ?? null,
    lines: [
      {
        barcode: over.barcode ?? BARCODE,
        quantity: 1,
        // invalid → non-numeric lineSaleGross → upsert new Decimal() throws.
        lineListGross: '100.00',
        lineSaleGross: over.invalid === true ? 'NOT_A_NUMBER' : '100.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '18',
        commissionRate: '15',
        commissionGross: '15.00',
        refundedCommissionGross: '0.00',
        commissionVatRate: '20',
      },
    ],
  };
  return value as unknown as Prisma.InputJsonValue;
}

async function seedCalculableVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
): Promise<void> {
  const profile = await createCostProfile(organizationId, { amountGross: '48.00' });
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Promote Test Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      costProfileLinks: { create: { organizationId, profileId: profile.id } },
    },
  });
}

describe('processBufferPromote', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('promotes a PROMOTING entry to orders and deletes the buffer row', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);

    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-001',
      platformOrderNumber: 'ord-001',
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-001',
        platformOrderNumber: 'ord-001',
        fastDeliveryType: 'FastDelivery',
        estimatedDeliveryStartDate: '2026-06-12T15:57:28.000Z',
        estimatedDeliveryEndDate: '2026-06-13T11:38:56.000Z',
        actualShipDate: '2026-06-12T11:35:54.000Z',
      }),
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('pkg-001');
    expect(order.estimatedNetProfit).not.toBeNull();
    // Buffer graduation stamps promotedFromBufferAt so the realtime toast can
    // suppress a duplicate ding for an order the seller already saw buffered.
    expect(order.promotedFromBufferAt).not.toBeNull();
    // Buffer JSONB round-trip: ISO-string tarihler new Date() ile coerce edilir,
    // fastDeliveryType ?? null ile geçer (2026-06-14 capture — review gap kapatma).
    expect(order.fastDeliveryType).toBe('FastDelivery');
    expect(order.estimatedDeliveryStartDate?.toISOString()).toBe('2026-06-12T15:57:28.000Z');
    expect(order.estimatedDeliveryEndDate?.toISOString()).toBe('2026-06-13T11:38:56.000Z');
    expect(order.actualShipDate?.toISOString()).toBe('2026-06-12T11:35:54.000Z');
  });

  it('does not pick up a FAILED entry before its backoff window elapses', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);

    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-backoff',
      status: 'FAILED',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-backoff' }),
    });
    // attempts=1 needs a 5-min wait; failed 2 min ago → not yet due.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 1, lastFailedAt: new Date(Date.now() - 2 * 60_000), lastError: 'x' },
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(1);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('marks FAILED + increments attempts when the promote throws', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Calculable variant: the calc gate passes, then the invalid lineSaleGross
    // makes the upsert throw — pins the tx-failure retry machinery.
    await seedCalculableVariant(org.id, store.id, BARCODE);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-fail',
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-fail', invalid: true }),
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBeTruthy();
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('marks PERMANENT_FAILED when the final (4th) attempt still fails', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-perm',
      status: 'FAILED',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-perm', invalid: true }),
    });
    // attempts=3, failed 60 min ago (> 45) → due for its final retry; it fails.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 3, lastFailedAt: new Date(Date.now() - 60 * 60_000), lastError: 'x' },
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.attempts).toBe(4);
    expect(after.status).toBe('PERMANENT_FAILED');
  });

  it('flush-failed handoff: past-day FAILED entry with missing cost graduates PROFIT-EXCLUDED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // No cost seeded — the entry is NOT calculable. A flush failure handed it
    // to the promote retry path; the retry must keep the exclusion semantics,
    // never the full write (that would resurrect the dead third state).
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-flush-handoff',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 24 * 60 * 60_000)),
      status: 'FAILED',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-flush-handoff' }),
    });
    // attempts=1, failed 10 min ago (> 5) → due for retry.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 1, lastFailedAt: new Date(Date.now() - 10 * 60_000), lastError: 'x' },
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.estimatedNetProfit).toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
    expect(await prisma.orderFee.count({ where: { orderId: order.id } })).toBe(0);
    // Excluded graduation is still a buffer -> orders write: it must carry the
    // promotion marker so the toast suppresses this midnight-path INSERT (C2).
    expect(order.promotedFromBufferAt).not.toBeNull();
  });

  it('cost vanished on a today PROMOTING entry → demoted back to PENDING (window still open)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // PROMOTING but no cost in the catalog (e.g. profile archived after the
    // flip): today's window is still open → entry returns to PENDING, no
    // orders row is written.
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-demote',
      orderDate: getBusinessDateAnchor(),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-demote' }),
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('PENDING');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('promote applies the out-of-order guard: stale buffer snapshot deletes the row but never regresses a newer order', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);

    // T1 < T2 — the buffered snapshot is OLDER than the order row's watermark.
    const T1 = new Date('2026-06-12T10:00:00.000Z');
    const T2 = new Date('2026-06-12T12:00:00.000Z');

    // A newer event already wrote the order (status SHIPPED, watermark T2). This
    // is the racing-delivery case: the same order was buffered earlier at T1 and
    // its cost only just arrived, flipping the buffer row to PROMOTING.
    await prisma.order.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformOrderId: 'pkg-guard',
        platformOrderNumber: 'ord-guard',
        orderDate: new Date('2026-06-12T09:00:00.000Z'),
        status: 'SHIPPED',
        platformLastModifiedAt: T2,
      },
    });

    // Matching PROMOTING buffer row whose snapshot carries the OLDER lmd (T1) and
    // a regressive status (PROCESSING via buildMappedOrder's default).
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-guard',
      platformOrderNumber: 'ord-guard',
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-guard',
        platformOrderNumber: 'ord-guard',
        lastModifiedDate: T1.toISOString(),
      }),
    });

    await processBufferPromote();

    // Buffer row consumed (no lingering placeholder → no double-count) …
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    // … but the order write was skipped by the guard: still exactly one row,
    // status + watermark unchanged at the newer T2 event (no regression).
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.status).toBe('SHIPPED');
    expect(order.platformLastModifiedAt?.toISOString()).toBe(T2.toISOString());
  });
});

describe('processPastDayBufferFlush', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  it('graduates a PENDING past-day entry PROFIT-EXCLUDED and deletes the buffer row', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // No cost seeded → cost window missed → permanent exclusion (spec 2026-06-12).
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-pending',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS)),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-pending', barcode: 'EAN13-FLUSH' }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-pending');
    expect(order.estimatedNetProfit).toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
    expect(order.profitExcludedAt).not.toBeNull();
    // Kâr-dışı sipariş PSF/Stopaj ESTIMATE satırı da taşımaz.
    expect(await prisma.orderFee.count({ where: { orderId: order.id } })).toBe(0);
    // The midnight flush is exactly the buffer -> orders path whose toast C2 must
    // suppress: the graduated order carries the promotion marker.
    expect(order.promotedFromBufferAt).not.toBeNull();
  });

  it('does NOT flush a today PENDING entry (same-day cost window preserved)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-today',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-today', barcode: 'EAN13-FLUSH' }),
    });

    await processPastDayBufferFlush();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('PENDING');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('leaves PROMOTING / FAILED past-day entries to the promote tick (only PENDING is flushed)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const promoting = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-promoting',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS)),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-promoting', barcode: 'EAN13-FLUSH' }),
    });

    await processPastDayBufferFlush();

    // Untouched by flush — promote owns PROMOTING/FAILED.
    expect(await prisma.livePerformanceBuffer.count({ where: { id: promoting.id } })).toBe(1);
  });

  it('marks FAILED when graduation throws (handed off to the promote retry path)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-bad',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - ONE_DAY_MS)),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-bad', invalid: true }),
    });

    await processPastDayBufferFlush();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(1);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });
});
