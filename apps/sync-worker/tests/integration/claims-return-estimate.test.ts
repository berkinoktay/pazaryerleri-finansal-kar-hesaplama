// Claims handler -> profit recompute queue integration test (phase 3B, Task 5).
//
// The claims handler no longer calls estimateReturnOnClaim. Instead a claim upsert
// that changes the claim's profit inputs enqueues a profit recompute for the claim's
// order (and, on a re-anchor, the order the claim left), and the recompute tick turns
// an accepted claim into the return legs. This suite verifies:
//   (1) creating a claim and changing an item status enqueue the order, an unchanged
//       re-scan enqueues nothing, and a re-anchor enqueues BOTH the old and the new
//       order;
//   (2) draining an order with an accepted claim writes the SALE_RETURN and
//       COMMISSION_REFUND ESTIMATE profit lines for the returned item.
//
// Requires: `supabase start` + `pnpm db:push`.
// Run: pnpm --filter sync-worker test:integration -- claims-return-estimate

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { ProfitLineCertainty, ProfitLineType, ProfitRecomputeReason } from '@pazarsync/db/enums';
import type { FetchClaimsOpts, TrendyolClaim } from '@pazarsync/marketplace';
import { drainProfitRecomputeQueue } from '@pazarsync/profit';
import { encryptCredentials } from '@pazarsync/sync-core';

import { processClaimsChunk, type ClaimsFetchers } from '../../src/handlers/claims';

import {
  createCostProfile,
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

// ─── Constants ────────────────────────────────────────────────────────────

const OUTBOUND_PACKAGE_ID = 73_001_234;
const REANCHOR_OUTBOUND_PACKAGE_ID = 73_009_999;
const ORDER_NUMBER = 'RET-TEST-001';
const REANCHOR_ORDER_NUMBER = 'RET-TEST-REANCHOR';
const PLATFORM_LINE_ID = 88_991_122n;
const ITEM_BARCODE = 'RET-EST-BARCODE';
const CLAIM_ITEM_ID_ACCEPTED = 'claim-item-accepted-001';
const TRENDYOL_CLAIM_ID = 'eabc1234-return-estimate-test';

// ─── Scenario builder ─────────────────────────────────────────────────────

interface ScenarioCtx {
  storeId: string;
  organizationId: string;
  orderId: string;
  orderItemId: string;
  syncLogId: string;
}

/**
 * A Trendyol store with one costed order: a catalog variant with an active cost
 * profile version (so the loader costs it), the SENDEOMP carrier for return
 * shipping, and the production fee definitions. The order line carries its own
 * commission rate so the estimate writes a COMMISSION line (and its refund leg).
 */
async function buildScenario(): Promise<ScenarioCtx> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  await ensureFeeDefinitions();

  const carrier = await prisma.shippingCarrier.findFirstOrThrow({
    where: { platform: 'TRENDYOL', code: 'SENDEOMP' },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Return Estimate Test Store',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: '5001',
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
      productMainId: 'pm-return-estimate',
      title: 'Return Estimate Product',
    },
  });
  // The factory seeds the profile's version 1.
  const costProfile = await createCostProfile(org.id, { storeId: store.id, amountGross: '500.00' });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: ITEM_BARCODE,
      stockCode: 'sk-return-estimate',
      salePrice: '1100',
      listPrice: '1100',
      syncedDimensionalWeight: '5',
      costProfileLinks: { create: { organizationId: org.id, profileId: costProfile.id } },
    },
  });

  // Per-unit: sale 1100 (VAT 10%), commission 10%, cost 500 (via the profile).
  const order = await prisma.order.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformOrderId: OUTBOUND_PACKAGE_ID.toString(),
      platformOrderNumber: ORDER_NUMBER,
      orderDate: new Date(),
      status: 'DELIVERED',
      saleGross: new Decimal('1100.00'),
      saleVat: new Decimal('100.00'),
      cargoDeci: new Decimal('5.00'),
    },
  });

  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: org.id,
      productVariantId: variant.id,
      barcode: ITEM_BARCODE,
      platformLineId: PLATFORM_LINE_ID,
      quantity: 1,
      orderCommissionRatePct: new Decimal('10.00'),
      lineListGross: new Decimal('1100.00'),
      lineSaleGross: new Decimal('1100.00'),
      lineSellerDiscountGross: new Decimal('0.00'),
      saleVatRate: new Decimal('10.00'),
    },
  });

  const syncLog = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'CLAIMS',
      status: 'RUNNING',
      startedAt: new Date(),
      claimedAt: new Date(),
      claimedBy: 'worker-test',
      lastTickAt: new Date(),
      progressCurrent: 0,
    },
  });

  return {
    storeId: store.id,
    organizationId: org.id,
    orderId: order.id,
    orderItemId: orderItem.id,
    syncLogId: syncLog.id,
  };
}

// ─── Wire claim builders ───────────────────────────────────────────────────

function makeAcceptedClaim(over: Partial<TrendyolClaim> = {}): TrendyolClaim {
  return {
    id: TRENDYOL_CLAIM_ID,
    claimId: TRENDYOL_CLAIM_ID,
    orderNumber: ORDER_NUMBER,
    orderDate: Date.now() - 86_400_000,
    claimDate: Date.now() - 43_200_000,
    lastModifiedDate: Date.now(),
    customerFirstName: 'Test',
    customerLastName: 'Musteri',
    cargoTrackingNumber: 7_330_000_000_000_000,
    cargoProviderName: 'Trendyol Express',
    orderShipmentPackageId: 73_001_235,
    orderOutboundPackageId: OUTBOUND_PACKAGE_ID,
    items: [
      {
        orderLine: { id: Number(PLATFORM_LINE_ID), barcode: '1234567890123' },
        claimItems: [
          {
            id: CLAIM_ITEM_ID_ACCEPTED,
            orderLineItemId: 10_000_001,
            customerClaimItemReason: {
              id: 401,
              name: 'Vazgectim',
              externalReasonId: 25,
              code: 'ABANDON',
            },
            claimItemStatus: { name: 'Accepted' },
            resolved: true,
            acceptedBySeller: true,
          },
        ],
      },
    ],
    ...over,
  };
}

function makeMockFetchers(claims: TrendyolClaim[]): ClaimsFetchers {
  return {
    fetchClaims: async function* (_opts: FetchClaimsOpts): AsyncGenerator<TrendyolClaim, void> {
      for (const c of claims) yield c;
    },
  };
}

async function runChunk(syncLogId: string, claims: TrendyolClaim[]): Promise<void> {
  const syncLog = await prisma.syncLog.findUniqueOrThrow({ where: { id: syncLogId } });
  await processClaimsChunk(
    { syncLog, cursor: null, workerId: 'worker-test' },
    makeMockFetchers(claims),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('processClaimsChunk — profit recompute queue (Task 5)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('enqueues the order on create and on a status change, and both orders on a re-anchor', async () => {
    const ctx = await buildScenario();

    // Creating a claim enqueues the order whatever its item statuses are.
    const waiting = makeAcceptedClaim();
    for (const group of waiting.items ?? []) {
      for (const ci of group.claimItems) {
        ci.claimItemStatus = { name: 'WaitingInAction' };
        ci.resolved = false;
        ci.acceptedBySeller = false;
      }
    }
    await runChunk(ctx.syncLogId, [waiting]);
    const firstQueued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: ctx.orderId },
    });
    expect(firstQueued?.reason).toBe(ProfitRecomputeReason.CLAIM_CHANGED);

    // An unchanged second scan leaves the queue empty.
    await prisma.profitRecomputeRequest.deleteMany({ where: { storeId: ctx.storeId } });
    await runChunk(ctx.syncLogId, [waiting]);
    expect(await prisma.profitRecomputeRequest.count({ where: { storeId: ctx.storeId } })).toBe(0);

    // A status change (WaitingInAction -> Accepted) enqueues the order again.
    await runChunk(ctx.syncLogId, [makeAcceptedClaim()]);
    const statusQueued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: ctx.orderId },
    });
    expect(statusQueued?.reason).toBe(ProfitRecomputeReason.CLAIM_CHANGED);

    // Clear the queue, then move the SAME Trendyol claim onto a second order of the
    // same store -> the re-anchor enqueues BOTH the old and the new order.
    await prisma.profitRecomputeRequest.deleteMany({ where: { storeId: ctx.storeId } });
    const secondOrder = await prisma.order.create({
      data: {
        organizationId: ctx.organizationId,
        storeId: ctx.storeId,
        platformOrderId: REANCHOR_OUTBOUND_PACKAGE_ID.toString(),
        platformOrderNumber: REANCHOR_ORDER_NUMBER,
        orderDate: new Date(),
        status: 'DELIVERED',
        saleGross: new Decimal('1100.00'),
        saleVat: new Decimal('100.00'),
      },
    });

    await runChunk(ctx.syncLogId, [
      makeAcceptedClaim({
        orderOutboundPackageId: REANCHOR_OUTBOUND_PACKAGE_ID,
        orderNumber: REANCHOR_ORDER_NUMBER,
      }),
    ]);

    const oldQueued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: ctx.orderId },
    });
    const newQueued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: secondOrder.id },
    });
    expect(oldQueued?.reason).toBe(ProfitRecomputeReason.CLAIM_CHANGED);
    expect(newQueued?.reason).toBe(ProfitRecomputeReason.CLAIM_CHANGED);
  });

  it('recomputes an accepted return into return lines through the queue', async () => {
    const ctx = await buildScenario();

    await runChunk(ctx.syncLogId, [makeAcceptedClaim()]);

    // The claim upsert enqueued the order; no legacy OrderFee is written anymore.
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: ctx.orderId },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.CLAIM_CHANGED);

    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });

    // The drain read the accepted claim item and wrote the return legs as ESTIMATE
    // profit lines for the returned item (no settlement yet).
    const returnLines = await prisma.profitLine.findMany({
      where: {
        orderId: ctx.orderId,
        orderItemId: ctx.orderItemId,
        certainty: ProfitLineCertainty.ESTIMATE,
        type: { in: [ProfitLineType.SALE_RETURN, ProfitLineType.COMMISSION_REFUND] },
      },
      select: { type: true },
    });
    const types = new Set(returnLines.map((line) => line.type));
    expect(types.has(ProfitLineType.SALE_RETURN)).toBe(true);
    expect(types.has(ProfitLineType.COMMISSION_REFUND)).toBe(true);
  });
});
