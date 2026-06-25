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
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * Returns the seeded SENDEOMP carrier id so the store can reference it as
 * defaultShippingCarrier. Shipping reference data is a READ-ONLY fixture seeded
 * once by globalSetup (@pazarsync/db/test-support) — tests never create or
 * truncate it. The RETURN_SHIPPING estimate resolves via the desi path
 * (estimateReturnOnClaim passes applyBarem:false): cargoDeci=5 → ceil(5)=5 →
 * SENDEOMP desi tariff at desi=5 net 121.99.
 */
async function getSeededCarrierId(): Promise<string> {
  const carrier = await prisma.shippingCarrier.findFirstOrThrow({ where: { code: 'SENDEOMP' } });
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

  const carrierId = await getSeededCarrierId();

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
      {
        // Mikro ihracat: estimate-on-order-create (estimateReturnOnClaim sonunda çağrılır)
        // mikro siparişte Uluslararası Hizmet Bedeli'ni resolve eder → seed gerekli.
        platform: 'TRENDYOL',
        feeType: 'INTERNATIONAL_SERVICE',
        displayName: 'Uluslararası Hizmet Bedeli',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: new Decimal('0.0600'),
        defaultVatRate: new Decimal('20.00'),
        effectiveFrom: new Date('2024-01-01'),
      },
    ],
  });
}

interface BuildOrderArgs {
  quantity: number;
  profitExcludedAt?: Date;
  /** Mikro ihracat siparişi (satış KDV %0, iade modeli OVERSEAS_RETURN_OPERATION). */
  micro?: boolean;
  /** İade edilen komisyon (satıcı-indiriminin komisyon payı) — effective komisyon testi için. */
  refundedCommissionGross?: string;
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
  const micro = args.micro ?? false;
  // Per-unit: sale 1100 (VAT 10%), cost 500 (VAT 10%), commission 110 (VAT 20%).
  // Mikro ihracatta satış KDV %0 (ihracat istisnası — upsert kaynakta sıfırlar).
  const lineSaleGross = new Decimal('1100.00').mul(qty);
  const saleVat = micro ? new Decimal('0.00') : lineSaleGross.mul(10).div(110).toDecimalPlaces(2);

  const order = await prisma.order.create({
    data: {
      organizationId: orgId,
      storeId,
      platformOrderId: `test-claim-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'RETURNED',
      micro,
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
      saleVatRate: micro ? new Decimal('0.00') : new Decimal('10.00'),
      commissionRate: new Decimal('10.00'),
      commissionGross: new Decimal('110.00').mul(qty),
      commissionVatRate: new Decimal('20.00'),
      refundedCommissionGross: new Decimal(args.refundedCommissionGross ?? '0.00'),
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

    // Gross amounts: refund=1100, commission=110, cost=500, ret-shipping=121.99×1.2=146.39
    // (SENDEOMP desi=5 net 121.99, RETURN_SHIPPING VAT 20%).
    expect(byType.get('REFUND_DEDUCTION')?.amountGross.toFixed(2)).toBe('1100.00');
    expect(byType.get('COMMISSION_REFUND')?.amountGross.toFixed(2)).toBe('110.00');
    expect(byType.get('COST_RETURN')?.amountGross.toFixed(2)).toBe('500.00');
    expect(byType.get('RETURN_SHIPPING')?.amountGross.toFixed(2)).toBe('146.39');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estimatedNetProfit).not.toBeNull();
    expect(order.estimatedNetProfit!.toNumber()).toBeLessThan(0);
  });

  /**
   * Mikro ihracat iadesi: domestic bacaklar (REFUND_DEDUCTION/COMMISSION_REFUND/
   * COST_RETURN/RETURN_SHIPPING) YAZILMAZ — satış reverse edilmez. Bunun YERİNE tek
   * OVERSEAS_RETURN_OPERATION (DEBIT) kesilir: (satış − komisyon) × kademe-oranı.
   * Birim satış 1100 ≤ 2000₺ → %35 kademesi (globalSetup'tan seed'li). 1 birim kabul:
   * hakediş = 1100 − 110 = 990; bedel = 990 × 0.35 = 346.50.
   */
  it('micro export return: writes ONLY OVERSEAS_RETURN_OPERATION (no domestic legs)', async () => {
    const { orgId, storeId } = await createSeedContext();
    await seedFeeDefinitions();
    const { orderId, orderItemId } = await buildOrderWithItem(orgId, storeId, {
      quantity: 1,
      micro: true,
    });
    await createClaim(orgId, storeId, orderId, orderItemId, 1);

    await prisma.$transaction(async (tx) => {
      await estimateReturnOnClaim(orderId, tx);
    });

    // Domestic iade bacakları YAZILMAMALI (satış reverse edilmez).
    const domesticLegs = await prisma.orderFee.findMany({
      where: { orderId, feeType: { in: [...RETURN_FEE_TYPES, 'STOPPAGE_REFUND'] } },
    });
    expect(domesticLegs).toHaveLength(0);

    // Tek OVERSEAS_RETURN_OPERATION (DEBIT) = (1100 − 110) × 0.35 = 346.50.
    const opFees = await prisma.orderFee.findMany({
      where: { orderId, feeType: 'OVERSEAS_RETURN_OPERATION', source: 'ESTIMATE' },
    });
    expect(opFees).toHaveLength(1);
    expect(opFees[0]?.direction).toBe('DEBIT');
    expect(opFees[0]?.amountGross.toFixed(2)).toBe('346.50');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estimatedNetProfit).not.toBeNull();
  });

  /**
   * Mikro iade — İNDİRİMLİ sipariş: hakediş tabanındaki komisyon EFFECTIVE olmalı
   * (commissionGross − refundedCommissionGross), GROSS değil. Aksi halde indirimli
   * siparişte iade bedeli `refundedComm × oran` kadar EKSİK çıkar (çift-düşme; canlı
   * doğrulama 2026-06-25, sipariş 775882190). Burada: satış 1100, komisyon 110, iade
   * komisyonu 20 → effective 90 → hakediş 1100 − 90 = 1010 → bedel 1010 × %35 = 353.50.
   * (GROSS yanlış değeri 990 × %35 = 346.50 verirdi.)
   */
  it('micro export return (discounted): uses EFFECTIVE commission, not gross', async () => {
    const { orgId, storeId } = await createSeedContext();
    await seedFeeDefinitions();
    const { orderId, orderItemId } = await buildOrderWithItem(orgId, storeId, {
      quantity: 1,
      micro: true,
      refundedCommissionGross: '20.00',
    });
    await createClaim(orgId, storeId, orderId, orderItemId, 1);

    await prisma.$transaction((tx) => estimateReturnOnClaim(orderId, tx));

    const op = await prisma.orderFee.findFirstOrThrow({
      where: { orderId, feeType: 'OVERSEAS_RETURN_OPERATION', source: 'ESTIMATE' },
    });
    expect(op.amountGross.toFixed(2)).toBe('353.50'); // (1100 − (110−20)) × %35
    expect(op.amountGross.toFixed(2)).not.toBe('346.50'); // gross-komisyon (çift-düşme) DEĞİL
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
