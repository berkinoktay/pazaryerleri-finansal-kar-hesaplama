/**
 * End-to-end lifecycle integration test for the return-into-profit feature.
 *
 * Mirrors real competitor-validated order 11307800224 (full return, KDV 10%,
 * cargoDeci 5). Two phases:
 *
 * 1. ESTIMATE phase — call estimateReturnOnClaim:
 *    - 4 ESTIMATE return-leg OrderFee rows must be written.
 *    - estimatedNetProfit must be negative (return ate the revenue).
 *
 * 2. RECONCILE phase — write ACTUAL legs (SETTLEMENT / CARGO_INVOICE) with
 *    DIFFERENT amounts than the estimate, then call recomputeSettledProfit:
 *    - settledNetProfit must be negative.
 *    - settledNetProfit must reflect ACTUAL amounts, NOT the estimate
 *      (per-leg prefer-actual is the core invariant of resolveReturnLegs).
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 * Run: pnpm --filter @pazarsync/profit test:integration -- return-into-profit-e2e
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { estimateReturnOnClaim } from '../estimate-return-on-claim';
import { recomputeSettledProfit } from '../recompute-settled-profit';

// ---- Shared DB helpers -------------------------------------------------------

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
       shipping_desi_tariffs,
       shipping_barem_tariffs,
       shipping_carriers,
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

/**
 * Seeds a carrier + a desi tariff at desi=5 (cargoDeci=5 -> ceil=5 -> 50.00 net).
 * Returns the carrier id so the store can reference it as defaultShippingCarrier.
 */
async function seedCarrierWithDesiTariff(): Promise<string> {
  const carrier = await prisma.shippingCarrier.create({
    data: {
      platform: 'TRENDYOL',
      externalId: Math.floor(Math.random() * 1_000_000),
      code: `TEST-CARRIER-${randomUUID().slice(0, 6)}`,
      displayName: 'Test Kargo',
      supportsBaremDestek: true,
      maxBaremDesi: 10,
    },
  });

  await prisma.shippingDesiTariff.create({
    data: { carrierId: carrier.id, desi: 5, priceNet: new Decimal('50.00') },
  });

  return carrier.id;
}

async function createSeedContext(): Promise<{ orgId: string; storeId: string }> {
  const userId = randomUUID();
  const orgId = randomUUID();

  await prisma.userProfile.create({
    data: { id: userId, email: `${userId}@test.local`, fullName: 'Test User' },
  });

  const org = await prisma.organization.create({
    data: { id: orgId, name: 'Test Org', slug: `test-org-${orgId.slice(0, 8)}` },
  });

  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId, role: 'OWNER' },
  });

  const carrierId = await seedCarrierWithDesiTariff();

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Test Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: randomUUID(),
      status: 'ACTIVE',
      credentials: 'test-encrypted-blob',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrierId,
    },
  });

  return { orgId: org.id, storeId: store.id };
}

/**
 * Seeds FeeDefinition rows required by estimateReturnOnClaim + applyEstimateOnOrderCreate.
 * PSF, STOPPAGE, SHIPPING, and RETURN_SHIPPING — RETURN_SHIPPING carries the VAT
 * used to gross-up the net return-shipping tariff.
 */
async function seedFeeDefinitions(): Promise<void> {
  await prisma.feeDefinition.createMany({
    data: [
      {
        platform: 'TRENDYOL',
        feeType: 'PLATFORM_SERVICE',
        displayName: 'Platform Hizmet Bedeli',
        calculationKind: 'FIXED',
        fixedAmountNet: new Decimal('9.16'),
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
      {
        platform: 'TRENDYOL',
        feeType: 'STOPPAGE',
        displayName: 'E-ticaret Stopaji',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: new Decimal('0.01'),
        defaultVatRate: new Decimal('0.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
      {
        platform: 'TRENDYOL',
        feeType: 'SHIPPING',
        displayName: 'Kargo Bedeli',
        calculationKind: 'FORMULA',
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
      {
        platform: 'TRENDYOL',
        feeType: 'RETURN_SHIPPING',
        displayName: 'Iade Kargo Bedeli',
        calculationKind: 'FORMULA',
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
    ],
  });
}

/**
 * Scenario mirrors real order 11307800224 (full return, KDV 10%, cargoDeci 5).
 *
 * saleGross=2361.71 (KDV 10%): saleVat = 2361.71 * 10/110 = 214.70
 * item: unitCostSnapshotGross=1000.00 (VAT 10%), commissionGross=236.17 (VAT 20%)
 * forward fees: SHIPPING CARGO_INVOICE 155.99 @ 20%, PSF ESTIMATE confirmed 13.19 @ 20%
 * settledNetProfit pre-set non-null so recomputeSettledProfit writes over it.
 */
async function buildE2EOrder(
  orgId: string,
  storeId: string,
): Promise<{ orderId: string; orderItemId: string }> {
  const order = await prisma.order.create({
    data: {
      organizationId: orgId,
      storeId,
      platformOrderId: `test-e2e-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'RETURNED',
      saleGross: new Decimal('2361.71'),
      saleVat: new Decimal('214.70'), // 2361.71 * 10/110 = 214.7009... persisted as 214.70
      cargoDeci: new Decimal('5.00'),
      // Pre-set so recomputeSettledProfit doesn't early-return
      estimatedNetProfit: new Decimal('999.00'),
      reconciliationStatus: 'NOT_SETTLED',
    },
  });

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: orgId,
      quantity: 1,
      lineListGross: new Decimal('2361.71'),
      lineSaleGross: new Decimal('2361.71'),
      saleVatRate: new Decimal('10.00'),
      commissionRate: new Decimal('10.00'),
      commissionGross: new Decimal('236.17'),
      commissionVatRate: new Decimal('20.00'),
      estimatedCommissionGross: new Decimal('236.17'),
      refundedCommissionGross: new Decimal('0.00'),
      unitCostSnapshotGross: new Decimal('1000.00'),
      unitCostSnapshotVatRate: new Decimal('10.00'),
    },
  });

  // Forward SHIPPING (CARGO_INVOICE) — real settled cost
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

  // Forward PSF (ESTIMATE, confirmed) — enters settled path via confirmedAt
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

  return { orderId: order.id, orderItemId: item.id };
}

/**
 * Creates an OrderClaim with one Accepted OrderClaimItem linked to the item.
 */
async function createAcceptedClaim(
  orgId: string,
  storeId: string,
  orderId: string,
  orderItemId: string,
): Promise<void> {
  const claim = await prisma.orderClaim.create({
    data: {
      organizationId: orgId,
      storeId,
      orderId,
      trendyolClaimId: `claim-${randomUUID().slice(0, 8)}`,
      claimDate: new Date(),
      resolved: false,
    },
  });

  await prisma.orderClaimItem.create({
    data: {
      claimId: claim.id,
      orderItemId,
      trendyolClaimItemId: `acc-${randomUUID()}`,
      reasonCode: 'DAMAGEDITEM',
      reasonName: 'Hasarli urun',
      status: 'Accepted',
      acceptedBySeller: true,
      resolved: true,
    },
  });
}

const RETURN_FEE_TYPES = [
  'REFUND_DEDUCTION',
  'COMMISSION_REFUND',
  'COST_RETURN',
  'RETURN_SHIPPING',
] as const;

// ---- Tests -------------------------------------------------------------------

describe('return-into-profit e2e lifecycle', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // CI paylaşılan DB: bıraktığımız custom carrier/seed satırları sonraki suite'e (api list-carriers) sızmasın diye suite sonunda temizle.
  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM shipping_desi_tariffs WHERE carrier_id IN (SELECT id FROM shipping_carriers WHERE code LIKE 'TEST-%')`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM shipping_carriers WHERE code LIKE 'TEST-%'`);
  });

  /**
   * Full lifecycle test mirroring order 11307800224.
   *
   * ESTIMATE PHASE: estimateReturnOnClaim writes 4 ESTIMATE return-leg rows and
   * makes estimatedNetProfit negative.
   *
   * RECONCILE PHASE: ACTUAL legs (SETTLEMENT/CARGO_INVOICE) are written with
   * INTENTIONALLY DIFFERENT amounts than the estimates. recomputeSettledProfit
   * must use the ACTUAL amounts (per-leg prefer-actual from resolveReturnLegs),
   * NOT the estimates. We prove this with a concrete settled-value assertion.
   *
   * Actual amounts (reconcile):
   *   REFUND_DEDUCTION (SETTLEMENT): 2300.00 @ 10%  [estimate was 2361.71]
   *   COMMISSION_REFUND (SETTLEMENT): 230.00 @ 20%  [estimate was 236.17]
   *   COST_RETURN (SETTLEMENT):       1000.00 @ 10% [same as estimate]
   *   RETURN_SHIPPING (CARGO_INVOICE): 165.00 @ 20% [estimate was 60.00]
   *
   * Expected settledNetProfit after reconcile (using ACTUAL amounts):
   *   After foldReturnLegs with ACTUAL:
   *     sale.gross = 2361.71 - 2300.00 = 61.71
   *     sale.vat   = 214.70 - 2300*10/110 = 214.70 - 209.0909... = 5.6090...
   *     commission.gross = 236.17 - 230.00 = 6.17
   *     commission.vat   = 236.17*20/120 - 230*20/120 = 39.3616... - 38.3333... = 1.0283...
   *                        but fold reduces: effectiveComm.gross=236.17, effectiveComm.vat=236.17*20/120
   *                        then sub COMMISSION_REFUND: 236.17*20/120 = 39.3616...
   *                        COMMISSION_REFUND.vat = 230*20/120 = 38.3333...
   *                        net commission.vat = 39.3616... - 38.3333... = 1.0283...
   *     cost.gross = 1000.00 - 1000.00 = 0
   *     cost.vat   = 1000*10/110 - 1000*10/110 = 0
   *     Forward fees (DEBIT): SHIPPING 155.99@20 + PSF 13.19@20 + RETURN_SHIPPING 165.00@20
   *       feeGross DEBIT = 155.99 + 13.19 + 165.00 = 334.18
   *       feeVat DEBIT   = 155.99*20/120 + 13.19*20/120 + 165.00*20/120
   *                      = 25.9983... + 2.1983... + 27.5 = 55.6966...
   *
   *   netVat = sale.vat - cost.vat - commission.vat - debitVat + creditVat
   *          = 5.6090... - 0 - 1.0283... - 55.6966... + 0
   *          = -51.1159...
   *
   *   netProfit = 61.71 - 0 - 6.17 - 334.18 - 0(stoppage) - (-51.1159...)
   *             = 61.71 - 0 - 6.17 - 334.18 + 51.1159...
   *             = -227.524...
   *
   * If estimate amounts were used instead (REFUND=2361.71, COMMISSION_REFUND=236.17,
   * RETURN_SHIPPING=60.00), the settled value would be different:
   *   sale.gross after fold = 2361.71 - 2361.71 = 0
   *   commission.gross after fold = 236.17 - 236.17 = 0
   *   feeGross DEBIT = 155.99 + 13.19 + 60.00 = 229.18
   *   netProfit (estimate-amounts) would be around ~-176.99 (very different from -227.52)
   * => the assertion on the concrete settled value proves ACTUAL was used.
   */
  it('e2e: estimate phase negative + reconcile uses ACTUAL (not ESTIMATE) amounts', async () => {
    const { orgId, storeId } = await createSeedContext();
    await seedFeeDefinitions();
    const { orderId, orderItemId } = await buildE2EOrder(orgId, storeId);
    await createAcceptedClaim(orgId, storeId, orderId, orderItemId);

    // ---- ESTIMATE PHASE ------------------------------------------------
    await prisma.$transaction(async (tx) => {
      await estimateReturnOnClaim(orderId, tx);
    });

    // 4 ESTIMATE return-leg rows must exist
    const estimateFees = await prisma.orderFee.findMany({
      where: { orderId, source: 'ESTIMATE', feeType: { in: [...RETURN_FEE_TYPES] } },
      select: { feeType: true, direction: true, amountGross: true },
    });
    expect(estimateFees).toHaveLength(4);

    const byTypeEstimate = new Map(estimateFees.map((f) => [f.feeType, f]));
    // Verify estimate amounts (REFUND from sale, COMMISSION from commissionGross)
    expect(byTypeEstimate.get('REFUND_DEDUCTION')?.amountGross.toFixed(2)).toBe('2361.71');
    expect(byTypeEstimate.get('COMMISSION_REFUND')?.amountGross.toFixed(2)).toBe('236.17');
    expect(byTypeEstimate.get('COST_RETURN')?.amountGross.toFixed(2)).toBe('1000.00');
    // RETURN_SHIPPING estimate: net 50.00 * 1.2 = 60.00
    expect(byTypeEstimate.get('RETURN_SHIPPING')?.amountGross.toFixed(2)).toBe('60.00');

    // estimatedNetProfit must be negative (return ate the revenue)
    const orderAfterEstimate = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfterEstimate.estimatedNetProfit).not.toBeNull();
    expect(orderAfterEstimate.estimatedNetProfit!.toNumber()).toBeLessThan(0);

    // ---- RECONCILE PHASE -----------------------------------------------
    // Write ACTUAL legs with intentionally different amounts to prove prefer-actual.
    // REFUND_DEDUCTION: SETTLEMENT 2300.00  (estimate was 2361.71 — DIFFERENT)
    // COMMISSION_REFUND: SETTLEMENT 230.00  (estimate was 236.17 — DIFFERENT)
    // COST_RETURN: SETTLEMENT 1000.00       (same as estimate — no ambiguity here)
    // RETURN_SHIPPING: CARGO_INVOICE 165.00 (estimate was 60.00 — VERY DIFFERENT)
    await prisma.orderFee.create({
      data: {
        orderId,
        organizationId: orgId,
        feeType: 'REFUND_DEDUCTION',
        source: 'SETTLEMENT',
        direction: 'DEBIT',
        amountGross: new Decimal('2300.00'),
        vatRate: new Decimal('10.00'),
      },
    });
    await prisma.orderFee.create({
      data: {
        orderId,
        organizationId: orgId,
        feeType: 'COMMISSION_REFUND',
        source: 'SETTLEMENT',
        direction: 'CREDIT',
        amountGross: new Decimal('230.00'),
        vatRate: new Decimal('20.00'),
      },
    });
    await prisma.orderFee.create({
      data: {
        orderId,
        organizationId: orgId,
        feeType: 'COST_RETURN',
        source: 'SETTLEMENT',
        direction: 'CREDIT',
        amountGross: new Decimal('1000.00'),
        vatRate: new Decimal('10.00'),
      },
    });
    await prisma.orderFee.create({
      data: {
        orderId,
        organizationId: orgId,
        feeType: 'RETURN_SHIPPING',
        source: 'CARGO_INVOICE',
        direction: 'DEBIT',
        amountGross: new Decimal('165.00'),
        vatRate: new Decimal('20.00'),
      },
    });

    await prisma.$transaction(async (tx) => {
      const result = await recomputeSettledProfit(orderId, tx);
      expect(result.recomputed).toBe(true);
    });

    const orderAfterReconcile = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(orderAfterReconcile.settledNetProfit).not.toBeNull();

    // Must be negative: return ate most of the revenue; forward + return shipping costs remain
    expect(orderAfterReconcile.settledNetProfit!.toNumber()).toBeLessThan(0);

    // ---- PREFER-ACTUAL PROOF -----------------------------------------------
    // The settled value must match the ACTUAL leg amounts, not the ESTIMATE amounts.
    //
    // With ACTUAL amounts:
    //   fold: sale.gross=61.71, commission.gross=6.17, cost.gross=0
    //   sale.vat = 214.70 - (2300 * 10/110) = 214.70 - 209.0909... = 5.6090...
    //   commission.vat = (236.17 * 20/120) - (230 * 20/120) = 39.3616... - 38.3333... = 1.0283...
    //   cost.vat = 0
    //   fees (DEBIT): fwd-shipping 155.99@20 + PSF 13.19@20 + ret-shipping 165.00@20
    //     feeGross = 334.18
    //     feeVat   = 25.9983... + 2.1983... + 27.5 = 55.6966...
    //   netVat = 5.6090... - 0 - 1.0283... - 55.6966... = -51.1159...
    //   netProfit = 61.71 - 0 - 6.17 - 334.18 - 0 - (-51.1159...) = -227.524...
    //   Rounded: -227.52
    //
    // With ESTIMATE amounts (counterfactual, should NOT appear):
    //   fold: sale.gross=0, commission.gross=0, cost.gross=0
    //   fees (DEBIT): fwd-shipping 155.99@20 + PSF 13.19@20 + ret-shipping 60.00@20
    //     feeGross = 229.18
    //     feeVat   = 25.9983... + 2.1983... + 10 = 38.1966...
    //   netVat = ~214.70 - ~90.90... - ~39.36... - 38.1966... (complex; roughly -176.xx)
    //   netProfit would be in a completely different range
    //
    // The concrete value proves ACTUAL was used.
    expect(orderAfterReconcile.settledNetProfit!.toFixed(2)).toBe('-227.52');
  });
});
