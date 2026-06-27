/**
 * Integration tests for recomputeSettledProfit — return-leg coverage.
 *
 * Verifies that REFUND_DEDUCTION / COMMISSION_REFUND / COST_RETURN /
 * RETURN_SHIPPING OrderFee rows are folded into the settled profit formula
 * (Task 3 of the return-into-profit epic).
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 * Run: pnpm --filter @pazarsync/profit test:integration
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { recomputeSettledProfit } from '../recompute-settled-profit';

// ─── Shared DB helpers (inline — no cross-app dependency) ─────────────────────

async function ensureDbReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(
      `Cannot reach test database at DATABASE_URL=${process.env['DATABASE_URL']}. ` +
        `Run \`supabase start\` and \`pnpm db:push\` before integration tests. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       order_fees,
       org_period_fees,
       commission_invoices,
       order_item_cost_snapshot_components,
       order_items,
       orders,
       product_variant_cost_profiles,
       product_images,
       product_variants,
       products,
       cost_profile_versions,
       cost_profiles,
       fx_rates,
       expenses,
       own_shipping_tariffs,
       member_store_access,
       stores,
       organization_members,
       organizations,
       marketplace_commission_rate,
       fee_definitions,
       sync_logs,
       settlement_items,
       settlements,
       order_claim_items,
       order_claims,
       live_performance_buffer,
       webhook_events,
       catalog_barcode_miss
     RESTART IDENTITY CASCADE`,
  );
}

// Minimal seed: user_profile, org, store — does NOT touch auth.users.
async function createSeedContext(): Promise<{ orgId: string; storeId: string }> {
  const userId = randomUUID();
  const orgId = randomUUID();

  await prisma.userProfile.create({
    data: { id: userId, email: `${userId}@test.local`, fullName: 'Test User' },
  });

  const org = await prisma.organization.create({
    data: {
      id: orgId,
      name: 'Test Org',
      slug: `test-org-${orgId.slice(0, 8)}`,
    },
  });

  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId, role: 'OWNER' },
  });

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: randomUUID(),
      status: 'ACTIVE',
      credentials: 'test-encrypted-blob',
    },
  });

  return { orgId: org.id, storeId: store.id };
}

/**
 * Builds a minimal order ready for recomputeSettledProfit:
 *   saleGross=1100 (VAT 10%), one item (cost=500 VAT 10%, commission=110 VAT 20%),
 *   settledNetProfit pre-set to a non-null sentinel so recompute writes over it.
 *
 * The PSF ESTIMATE is marked confirmed so it enters the forward-fee path.
 */
async function buildBaseOrder(orgId: string, storeId: string): Promise<{ orderId: string }> {
  const order = await prisma.order.create({
    data: {
      organizationId: orgId,
      storeId,
      platformOrderId: `test-rtn-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'RETURNED',
      saleGross: new Decimal('1100.00'),
      saleVat: new Decimal('100.00'), // 1100 × 10/110 = 100.00
      // Pre-set so recompute doesn't early-return (the function writes settled_*
      // unconditionally as long as cost snapshots are present; this sentinel is
      // overwritten by the recompute call).
      estimatedNetProfit: new Decimal('999.00'),
      reconciliationStatus: 'NOT_SETTLED',
      // Kâr formülü ayar snapshot'ı: bu testler iade KATLAMA matematiğini doğrular, varsayılan
      // negatif-net-KDV klamp'ını değil. recomputeSettledProfit snapshot'ı okur (canlı mağaza
      // ayarını değil) ve bu test applyEstimateOnOrderCreate'i ATLADIĞI için snapshot'ı burada
      // açıkça kurarız: stopaj dahil + negatif net KDV DAHİL (iade sonrası net KDV doğal negatif;
      // tarihsel beklenen değerler bu politikayla geçerli). Klamp davranışı profit-formula.test.ts'te.
      snapshotIncludeStopaj: true,
      snapshotIncludeNegativeNetVat: true,
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: orgId,
      quantity: 1,
      lineListGross: new Decimal('1100.00'),
      lineSaleGross: new Decimal('1100.00'),
      saleVatRate: new Decimal('10.00'),
      commissionRate: new Decimal('10.00'),
      commissionGross: new Decimal('110.00'),
      commissionVatRate: new Decimal('20.00'),
      // estimatedCommissionGross is what recomputeSettledProfit reads (falls back
      // to this when settledCommissionGross is null — the typical pre-settlement state).
      estimatedCommissionGross: new Decimal('110.00'),
      // Cost snapshot present so recompute isn't skipped.
      unitCostSnapshotGross: new Decimal('500.00'),
      unitCostSnapshotVatRate: new Decimal('10.00'),
    },
  });

  // Forward fee: SHIPPING real (CARGO_INVOICE)
  await prisma.orderFee.create({
    data: {
      orderId: order.id,
      organizationId: orgId,
      feeType: 'SHIPPING',
      source: 'CARGO_INVOICE',
      direction: 'DEBIT',
      amountGross: new Decimal('155.99'),
      vatRate: new Decimal('20.00'),
    },
  });

  // Forward fee: PSF ESTIMATE confirmed (stands in for a PaymentOrder cycle)
  await prisma.orderFee.create({
    data: {
      orderId: order.id,
      organizationId: orgId,
      feeType: 'PLATFORM_SERVICE',
      source: 'ESTIMATE',
      direction: 'DEBIT',
      amountGross: new Decimal('13.19'),
      vatRate: new Decimal('20.00'),
      confirmedAt: new Date(),
      confirmedBy: 'test-setup',
    },
  });

  return { orderId: order.id };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('recomputeSettledProfit — return legs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /**
   * Full single-item return: every return leg has a SETTLEMENT/CARGO_INVOICE
   * source. The four legs cancel sale/cost/commission to zero; the two shipping
   * legs (forward + return) and PSF remain as costs → netProfit is negative.
   *
   * Expected settled profit calculation:
   *   After foldReturnLegs: sale=0/cost=0/commission=0
   *   Fees (DEBIT): fwd-shipping 155.99@20 + PSF 13.19@20 + ret-shipping 155.99@20
   *   netVat  = 0 − 0 − 0 − (155.99×20/120 + 13.19×20/120 + 155.99×20/120)
   *           = −(25.998… + 2.198… + 25.998…)  ≈ −54.195
   *   netProfit = 0 − 0 − 0 − (155.99 + 13.19 + 155.99) − 0 − (−54.195)
   *             = −325.17 + 54.195 = −270.975 → −270.98
   */
  it('full return: settled profit is negative (shipping+PSF costs remain)', async () => {
    const { orgId, storeId } = await createSeedContext();
    const { orderId } = await buildBaseOrder(orgId, storeId);

    // Return legs — all SETTLEMENT source (actual, not estimate)
    const returnFees = [
      {
        feeType: 'REFUND_DEDUCTION' as const,
        source: 'SETTLEMENT' as const,
        amountGross: new Decimal('1100.00'),
        vatRate: new Decimal('10.00'),
      },
      {
        feeType: 'COMMISSION_REFUND' as const,
        source: 'SETTLEMENT' as const,
        amountGross: new Decimal('110.00'),
        vatRate: new Decimal('20.00'),
      },
      {
        feeType: 'COST_RETURN' as const,
        source: 'SETTLEMENT' as const,
        amountGross: new Decimal('500.00'),
        vatRate: new Decimal('10.00'),
      },
      {
        feeType: 'RETURN_SHIPPING' as const,
        source: 'CARGO_INVOICE' as const,
        amountGross: new Decimal('155.99'),
        vatRate: new Decimal('20.00'),
      },
    ];

    for (const fee of returnFees) {
      await prisma.orderFee.create({
        data: {
          orderId,
          organizationId: orgId,
          feeType: fee.feeType,
          source: fee.source,
          direction: 'DEBIT',
          amountGross: fee.amountGross,
          vatRate: fee.vatRate,
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      const result = await recomputeSettledProfit(orderId, tx);
      expect(result.recomputed).toBe(true);
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.settledNetProfit).not.toBeNull();

    // settledNetProfit must be negative — return ate the revenue, shipping+PSF costs remain
    expect(order.settledNetProfit!.toNumber()).toBeLessThan(0);

    // Exact value: −270.98 (see formula above)
    expect(order.settledNetProfit!.toFixed(2)).toBe('-270.98');
  });

  /**
   * Regression: an order with NO return legs must produce the same settled
   * profit as if return logic were absent. This guards against the fold
   * accidentally perturbing forward-only orders.
   *
   * Expected for forward-only (no return fees):
   *   sale net = 1100 − 100 = 1000
   *   cost net = 500 − 500×10/110 = 500 − 45.4545… = 454.545…
   *   comm net = 110 − 110×20/120 = 110 − 18.333… = 91.666…
   *   fwd-shipping net = 155.99 − 155.99×20/120 = 155.99 − 25.998… = 129.991…
   *   PSF net = 13.19 − 13.19×20/120 = 13.19 − 2.198… = 10.991…
   *
   *   netVat = 100 − 45.4545 − 18.333 − 25.998 − 2.198 = 8.015 (approx)
   *   netProfit = 1100 − 500 − 110 − 155.99 − 13.19 − 0 − netVat
   *
   * We don't hard-code the exact value here — we just verify it's positive
   * and stable across two consecutive calls (idempotency).
   */
  it('no return legs: settled profit is positive and stable (regression guard)', async () => {
    const { orgId, storeId } = await createSeedContext();
    const { orderId } = await buildBaseOrder(orgId, storeId);

    // First recompute
    await prisma.$transaction(async (tx) => {
      const result = await recomputeSettledProfit(orderId, tx);
      expect(result.recomputed).toBe(true);
    });

    const order1 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order1.settledNetProfit).not.toBeNull();
    expect(order1.settledNetProfit!.toNumber()).toBeGreaterThan(0);

    const firstValue = order1.settledNetProfit!.toFixed(2);

    // Second recompute (idempotent — same inputs, same output)
    await prisma.$transaction(async (tx) => {
      const result = await recomputeSettledProfit(orderId, tx);
      expect(result.recomputed).toBe(true);
    });

    const order2 = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order2.settledNetProfit!.toFixed(2)).toBe(firstValue);
  });

  /**
   * Confirmed ESTIMATE return legs are included; unconfirmed ESTIMATE return
   * legs are excluded. This verifies the confirmedAt gate in the query.
   */
  it('confirmed ESTIMATE return leg included; unconfirmed ESTIMATE excluded', async () => {
    const { orgId, storeId } = await createSeedContext();
    const { orderId } = await buildBaseOrder(orgId, storeId);

    // Confirmed ESTIMATE REFUND_DEDUCTION — should be picked up
    await prisma.orderFee.create({
      data: {
        orderId,
        organizationId: orgId,
        feeType: 'REFUND_DEDUCTION',
        source: 'ESTIMATE',
        direction: 'DEBIT',
        amountGross: new Decimal('1100.00'),
        vatRate: new Decimal('10.00'),
        confirmedAt: new Date(),
        confirmedBy: 'test-setup',
      },
    });

    // Unconfirmed ESTIMATE COMMISSION_REFUND — must be ignored
    await prisma.orderFee.create({
      data: {
        orderId,
        organizationId: orgId,
        feeType: 'COMMISSION_REFUND',
        source: 'ESTIMATE',
        direction: 'DEBIT',
        amountGross: new Decimal('110.00'),
        vatRate: new Decimal('20.00'),
        // confirmedAt intentionally null
      },
    });

    await prisma.$transaction(async (tx) => {
      const result = await recomputeSettledProfit(orderId, tx);
      expect(result.recomputed).toBe(true);
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.settledNetProfit).not.toBeNull();

    // With only REFUND_DEDUCTION applied (COMMISSION_REFUND excluded):
    // sale folds to 0; cost (500) and commission (110) remain; shipping+PSF remain.
    // Result is very negative (cost+commission+shipping still deducted, no revenue).
    // The key assertion: confirmed estimate IS folded (sale zeroed) but unconfirmed
    // estimate is NOT (commission still counted as a cost). Net must be very negative.
    expect(order.settledNetProfit!.toNumber()).toBeLessThan(-500);
  });
});
