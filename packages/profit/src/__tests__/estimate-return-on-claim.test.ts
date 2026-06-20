/**
 * Integration tests for estimateReturnOnClaim — return-into-profit Task 5.
 *
 * When a return is accepted (OrderClaimItem.status='Accepted'), the function
 * writes ONE ESTIMATE OrderFee per return fee_type (REFUND_DEDUCTION /
 * COMMISSION_REFUND / COST_RETURN / RETURN_SHIPPING) summed across accepted
 * units, then recomputes estimatedNetProfit return-aware.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 * Run: pnpm --filter @pazarsync/profit test:integration -- estimate-return-on-claim
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { estimateReturnOnClaim } from '../estimate-return-on-claim';

// ---- Shared DB helpers (inline — no cross-app dependency) ----------------------

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
 * Seeds a carrier + a desi tariff at desi=5 and points the store at it, so the
 * RETURN_SHIPPING estimate resolves (desi-based path, no barem). Returns the
 * carrier id so the store can reference it as defaultShippingCarrier.
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

  // cargoDeci=5 → ceil(5)=5 → desi tariff at desi=5 net 50.00.
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
 * Seeds the FeeDefinition rows estimateReturnOnClaim + applyEstimateOnOrderCreate
 * need: PSF + STOPPAGE + SHIPPING + RETURN_SHIPPING. RETURN_SHIPPING carries the
 * VAT used to gross-up the net return-shipping tariff.
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
        displayName: 'İade Kargo Bedeli',
        calculationKind: 'FORMULA',
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
    ],
  });
}

interface BuildOrderArgs {
  quantity: number;
  profitExcludedAt?: Date;
}

/**
 * Builds an order with a single item (cost snapshot + commission + sale) and a
 * cargoDeci so RETURN_SHIPPING can be estimated. saleGross/saleVat scale with
 * quantity. Returns orderId + orderItemId for claim wiring.
 */
async function buildOrderWithItem(
  orgId: string,
  storeId: string,
  args: BuildOrderArgs,
): Promise<{ orderId: string; orderItemId: string }> {
  const qty = args.quantity;
  // Per-unit: sale 1100 (VAT 10%), cost 500 (VAT 10%), commission 110 (VAT 20%).
  const lineSaleGross = new Decimal('1100.00').mul(qty);
  const saleVat = lineSaleGross.mul(10).div(110).toDecimalPlaces(2);

  const order = await prisma.order.create({
    data: {
      organizationId: orgId,
      storeId,
      platformOrderId: `test-claim-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'RETURNED',
      saleGross: lineSaleGross,
      saleVat,
      cargoDeci: new Decimal('5.00'),
      // CHECK orders_profit_exclusion_pair_check: at + reason set/null together.
      profitExcludedAt: args.profitExcludedAt ?? null,
      profitExclusionReason: args.profitExcludedAt !== undefined ? 'COST_DEADLINE_MISSED' : null,
    },
  });

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: orgId,
      quantity: qty,
      lineListGross: lineSaleGross,
      lineSaleGross,
      saleVatRate: new Decimal('10.00'),
      commissionRate: new Decimal('10.00'),
      commissionGross: new Decimal('110.00').mul(qty),
      commissionVatRate: new Decimal('20.00'),
      refundedCommissionGross: new Decimal('0.00'),
      unitCostSnapshotGross: new Decimal('500.00'),
      unitCostSnapshotVatRate: new Decimal('10.00'),
    },
  });

  return { orderId: order.id, orderItemId: item.id };
}

/**
 * Creates an OrderClaim with `acceptedUnits` Accepted OrderClaimItem rows linked
 * to the item, plus optional non-accepted rows (Rejected) that must be ignored.
 */
async function createClaim(
  orgId: string,
  storeId: string,
  orderId: string,
  orderItemId: string,
  acceptedUnits: number,
  rejectedUnits = 0,
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

  for (let i = 0; i < acceptedUnits; i += 1) {
    await prisma.orderClaimItem.create({
      data: {
        claimId: claim.id,
        orderItemId,
        trendyolClaimItemId: `acc-${randomUUID()}`,
        reasonCode: 'DAMAGEDITEM',
        reasonName: 'Hasarlı ürün',
        status: 'Accepted',
        acceptedBySeller: true,
        resolved: true,
      },
    });
  }

  for (let i = 0; i < rejectedUnits; i += 1) {
    await prisma.orderClaimItem.create({
      data: {
        claimId: claim.id,
        orderItemId,
        trendyolClaimItemId: `rej-${randomUUID()}`,
        reasonCode: 'DAMAGEDITEM',
        reasonName: 'Hasarlı ürün',
        status: 'Rejected',
        acceptedBySeller: false,
        resolved: true,
      },
    });
  }
}

const RETURN_FEE_TYPES = [
  'REFUND_DEDUCTION',
  'COMMISSION_REFUND',
  'COST_RETURN',
  'RETURN_SHIPPING',
] as const;

// ---- Tests -------------------------------------------------------------------

describe('estimateReturnOnClaim', () => {
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
   * Full single-unit return: one accepted claim item. After the call there must
   * be EXACTLY 4 ESTIMATE return-leg OrderFee rows (one per fee_type) and the
   * estimated profit must be negative (return ate the revenue, costs remain).
   */
  it('full return: writes exactly 4 ESTIMATE return-leg rows + negative profit', async () => {
    const { orgId, storeId } = await createSeedContext();
    await seedFeeDefinitions();
    const { orderId, orderItemId } = await buildOrderWithItem(orgId, storeId, { quantity: 1 });
    await createClaim(orgId, storeId, orderId, orderItemId, 1);

    await prisma.$transaction(async (tx) => {
      await estimateReturnOnClaim(orderId, tx);
    });

    // Exactly one ESTIMATE row per return fee_type → 4 rows total.
    const returnFees = await prisma.orderFee.findMany({
      where: { orderId, source: 'ESTIMATE', feeType: { in: [...RETURN_FEE_TYPES] } },
      select: { feeType: true, direction: true, amountGross: true },
    });
    expect(returnFees).toHaveLength(4);

    for (const feeType of RETURN_FEE_TYPES) {
      const rows = returnFees.filter((f) => f.feeType === feeType);
      expect(rows).toHaveLength(1);
    }

    // Directions follow the fold contract.
    const byType = new Map(returnFees.map((f) => [f.feeType, f]));
    expect(byType.get('REFUND_DEDUCTION')?.direction).toBe('DEBIT');
    expect(byType.get('COMMISSION_REFUND')?.direction).toBe('CREDIT');
    expect(byType.get('COST_RETURN')?.direction).toBe('CREDIT');
    expect(byType.get('RETURN_SHIPPING')?.direction).toBe('DEBIT');

    // Gross amounts: refund=1100, commission=110, cost=500, ret-shipping=50×1.2=60.
    expect(byType.get('REFUND_DEDUCTION')?.amountGross.toFixed(2)).toBe('1100.00');
    expect(byType.get('COMMISSION_REFUND')?.amountGross.toFixed(2)).toBe('110.00');
    expect(byType.get('COST_RETURN')?.amountGross.toFixed(2)).toBe('500.00');
    expect(byType.get('RETURN_SHIPPING')?.amountGross.toFixed(2)).toBe('60.00');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estimatedNetProfit).not.toBeNull();
    expect(order.estimatedNetProfit!.toNumber()).toBeLessThan(0);
  });

  /**
   * Profit-excluded order: estimateReturnOnClaim must early-return and write NO
   * return-leg ESTIMATE rows (profit calc is permanently frozen for the order).
   */
  it('profit-excluded order: writes no return-leg ESTIMATE rows', async () => {
    const { orgId, storeId } = await createSeedContext();
    await seedFeeDefinitions();
    const { orderId, orderItemId } = await buildOrderWithItem(orgId, storeId, {
      quantity: 1,
      profitExcludedAt: new Date(),
    });
    await createClaim(orgId, storeId, orderId, orderItemId, 1);

    await prisma.$transaction(async (tx) => {
      await estimateReturnOnClaim(orderId, tx);
    });

    const returnFees = await prisma.orderFee.findMany({
      where: { orderId, feeType: { in: [...RETURN_FEE_TYPES] } },
    });
    expect(returnFees).toHaveLength(0);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estimatedNetProfit).toBeNull();
  });

  /**
   * Partial return: 1 of 2 units accepted (+ 1 rejected unit that must be
   * ignored). Refund/commission/cost legs must be HALF the full-return values.
   */
  it('partial return (1 of 2 accepted): refund/commission/cost are half', async () => {
    const { orgId, storeId } = await createSeedContext();
    await seedFeeDefinitions();
    const { orderId, orderItemId } = await buildOrderWithItem(orgId, storeId, { quantity: 2 });
    // 1 accepted, 1 rejected → acceptedQty=1 of quantity=2.
    await createClaim(orgId, storeId, orderId, orderItemId, 1, 1);

    await prisma.$transaction(async (tx) => {
      await estimateReturnOnClaim(orderId, tx);
    });

    const returnFees = await prisma.orderFee.findMany({
      where: { orderId, source: 'ESTIMATE', feeType: { in: [...RETURN_FEE_TYPES] } },
      select: { feeType: true, amountGross: true },
    });
    const byType = new Map(returnFees.map((f) => [f.feeType, f]));

    // Per-unit sale=1100, commission=110, cost=500 → exactly one unit returned.
    expect(byType.get('REFUND_DEDUCTION')?.amountGross.toFixed(2)).toBe('1100.00');
    expect(byType.get('COMMISSION_REFUND')?.amountGross.toFixed(2)).toBe('110.00');
    expect(byType.get('COST_RETURN')?.amountGross.toFixed(2)).toBe('500.00');
  });
});
