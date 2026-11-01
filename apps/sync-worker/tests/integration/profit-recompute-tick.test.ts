// Profit recompute tick integration test (phase 3B, Task 9).
//
// The sync-worker tick is the one consumer of the profit recompute queue. This
// suite proves the two things the tick does end to end against the DB:
//   (1) a tick drains a queued order -- the mark is gone and a best-known profit
//       statement exists;
//   (2) when the queue is empty the tick sweeps an order that has no statement
//       into the queue (reason STALE_STATEMENT), so the engine-version migration
//       and the phase 3D backfill run on their own.
//
// Each test builds its own fresh tick via createProfitRecomputeTick so the sweep
// throttle state never leaks across tests.
//
// Requires: `supabase start` + `pnpm db:push`.
// Run: pnpm --filter sync-worker test:integration -- profit-recompute-tick

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitRecomputeReason, ProfitStatementView } from '@pazarsync/db/enums';
import { enqueueProfitRecomputeForStore } from '@pazarsync/profit';
import { encryptCredentials } from '@pazarsync/sync-core';

import { createProfitRecomputeTick } from '../../src/handlers/profit-recompute';

import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createCostProfile,
  createOrganization,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

interface CostedOrderCtx {
  readonly orderId: string;
  readonly storeId: string;
  readonly organizationId: string;
}

/**
 * A Trendyol store with one costed, computable order (mirrors the proven claims /
 * commission-fallback setup): a catalog variant with an active cost-profile version,
 * the SENDEOMP return carrier as the store default, a dimensional weight for the
 * shipping estimate, and the order line carrying its own commission rate. Draining
 * it writes a full best-known statement.
 */
async function buildCostedOrder(tag: string): Promise<CostedOrderCtx> {
  const org = await createOrganization();
  await ensureFeeDefinitions();

  const carrier = await prisma.shippingCarrier.findFirstOrThrow({
    where: { platform: 'TRENDYOL', code: 'SENDEOMP' },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: `Tick Test Store ${tag}`,
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: `acct-${tag}`,
      credentials: encryptCredentials({ supplierId: '5001', apiKey: 'k', apiSecret: 's' }),
      status: 'ACTIVE',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `pm-${tag}`,
      title: 'Tick Test Product',
    },
  });
  const costProfile = await createCostProfile(org.id, { storeId: store.id, amountGross: '500.00' });
  await prisma.costProfileVersion.create({
    data: {
      profileId: costProfile.id,
      organizationId: org.id,
      version: 1,
      name: costProfile.name,
      type: costProfile.type,
      amountGross: costProfile.amountGross,
      currency: 'TRY',
      vatRate: costProfile.vatRate,
      fxRateMode: 'AUTO',
      changedFields: [],
      changedAt: new Date('2024-01-01T00:00:00Z'),
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: `bar-${tag}`,
      stockCode: `sk-${tag}`,
      salePrice: '1100',
      listPrice: '1100',
      syncedDimensionalWeight: '5',
      costProfileLinks: { create: { organizationId: org.id, profileId: costProfile.id } },
    },
  });

  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: `po-${tag}`,
      platformOrderNumber: `on-${tag}`,
      orderDate: new Date(),
      status: 'DELIVERED',
      saleGross: new Decimal('1100.00'),
      saleVat: new Decimal('100.00'),
      cargoDeci: new Decimal('5.00'),
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      productVariantId: variant.id,
      barcode: `bar-${tag}`,
      platformLineId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      quantity: 1,
      commissionRate: new Decimal('10.00'),
      orderCommissionRatePct: new Decimal('10.00'),
      lineListGross: new Decimal('1100.00'),
      lineSaleGross: new Decimal('1100.00'),
      lineSellerDiscountGross: new Decimal('0.00'),
      saleVatRate: new Decimal('10.00'),
      commissionGross: new Decimal('110.00'),
      refundedCommissionGross: new Decimal('0.00'),
      commissionVatRate: new Decimal('20.00'),
      estimatedCommissionGross: new Decimal('110.00'),
    },
  });

  return { orderId: order.id, storeId: store.id, organizationId: org.id };
}

describe('profit recompute tick', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('drains the queue on a tick', async () => {
    const ctx = await buildCostedOrder('drain');

    // Enqueue the store's one order, then drive one tick.
    const enqueued = await prisma.$transaction((tx) =>
      enqueueProfitRecomputeForStore(tx, {
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        reason: ProfitRecomputeReason.MANUAL,
      }),
    );
    expect(enqueued).toBe(1);

    const tick = createProfitRecomputeTick({ db: prisma });
    const result = await tick();

    // The tick claimed and processed the one mark; a non-empty drain never sweeps.
    expect(result.skipped).toBe(false);
    expect(result.drain?.claimed).toBe(1);
    expect(result.swept).toBeNull();

    // The mark is gone and a best-known statement now exists for the order.
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);
    const statement = await prisma.orderProfitStatement.findFirst({
      where: { orderId: ctx.orderId, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(statement).not.toBeNull();
  });

  it('sweeps orders without statements when the queue is empty', async () => {
    const ctx = await buildCostedOrder('sweep');

    // The order is not queued and has no statement yet.
    expect(await prisma.profitRecomputeRequest.count()).toBe(0);

    const tick = createProfitRecomputeTick({ db: prisma });
    const result = await tick();

    // Empty queue -> the tick swept the stale order into the queue. (The sweep
    // enqueues; the drain picks it up on a later tick.)
    expect(result.drain?.claimed).toBe(0);
    expect(result.swept).not.toBeNull();
    expect(result.swept ?? 0).toBeGreaterThanOrEqual(1);

    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: ctx.orderId },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.STALE_STATEMENT);
  });
});
