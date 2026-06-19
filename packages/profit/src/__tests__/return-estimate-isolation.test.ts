/**
 * Multi-tenancy isolation test for estimateReturnOnClaim.
 *
 * Seeds TWO independent organizations (A and B), each with:
 *   - a store, an order with a cost-snapshotted item, and an accepted claim.
 *
 * Calls estimateReturnOnClaim for org A's order ONLY.
 *
 * Asserts:
 *   - Org A's order gets exactly 4 ESTIMATE return-leg OrderFee rows and a
 *     negative estimatedNetProfit.
 *   - Org B's order has ZERO return-leg OrderFee rows and an unchanged
 *     estimatedNetProfit (proves the function is strictly order/org-scoped
 *     and never leaks across tenants).
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 * Run: pnpm --filter @pazarsync/profit test:integration -- return-estimate-isolation
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { estimateReturnOnClaim } from '../estimate-return-on-claim';

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
 * Returns the carrier id.
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

interface TenantContext {
  orgId: string;
  storeId: string;
}

/**
 * Creates an org + store for a new tenant. Both tenants use the same carrier
 * (carrier is platform-scoped, not tenant-scoped).
 */
async function createTenantContext(carrierId: string): Promise<TenantContext> {
  const userId = randomUUID();
  const orgId = randomUUID();

  await prisma.userProfile.create({
    data: { id: userId, email: `${userId}@test.local`, fullName: 'Test User' },
  });

  const org = await prisma.organization.create({
    data: { id: orgId, name: `Tenant Org ${orgId.slice(0, 8)}`, slug: `org-${orgId.slice(0, 8)}` },
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
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrierId,
    },
  });

  return { orgId: org.id, storeId: store.id };
}

/**
 * Seeds FeeDefinition rows required by estimateReturnOnClaim + applyEstimateOnOrderCreate.
 * FeeDefinitions are platform-scoped (not tenant-scoped), so one seed covers both orgs.
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
 * Builds a minimal order eligible for estimateReturnOnClaim:
 *   saleGross=1100 (VAT 10%), item cost=500 (VAT 10%), commission=110 (VAT 20%)
 *   cargoDeci=5 so RETURN_SHIPPING can be estimated.
 * Returns orderId + orderItemId for claim wiring.
 */
async function buildOrderWithItem(
  orgId: string,
  storeId: string,
): Promise<{ orderId: string; orderItemId: string }> {
  const order = await prisma.order.create({
    data: {
      organizationId: orgId,
      storeId,
      platformOrderId: `test-iso-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'RETURNED',
      saleGross: new Decimal('1100.00'),
      saleVat: new Decimal('100.00'), // 1100 * 10/110
      cargoDeci: new Decimal('5.00'),
    },
  });

  const item = await prisma.orderItem.create({
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
      refundedCommissionGross: new Decimal('0.00'),
      unitCostSnapshotGross: new Decimal('500.00'),
      unitCostSnapshotVatRate: new Decimal('10.00'),
    },
  });

  return { orderId: order.id, orderItemId: item.id };
}

/**
 * Creates an OrderClaim with one Accepted OrderClaimItem linked to the given item.
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

describe('estimateReturnOnClaim — tenant isolation', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /**
   * Two tenants (A and B) each have an eligible order + accepted claim.
   * Only org A's order is processed; org B's data must remain untouched.
   *
   * Proves: estimateReturnOnClaim is strictly scoped to the given orderId
   * and never crosses the tenant boundary.
   */
  it('only org A gets return-leg ESTIMATE rows; org B remains untouched', async () => {
    // ---- Seed shared platform data -------------------------------------------
    await seedFeeDefinitions();
    const carrierId = await seedCarrierWithDesiTariff();

    // ---- Seed org A ----------------------------------------------------------
    const tenantA = await createTenantContext(carrierId);
    const { orderId: orderAId, orderItemId: itemAId } = await buildOrderWithItem(
      tenantA.orgId,
      tenantA.storeId,
    );
    await createAcceptedClaim(tenantA.orgId, tenantA.storeId, orderAId, itemAId);

    // ---- Seed org B ----------------------------------------------------------
    const tenantB = await createTenantContext(carrierId);
    const { orderId: orderBId, orderItemId: itemBId } = await buildOrderWithItem(
      tenantB.orgId,
      tenantB.storeId,
    );
    await createAcceptedClaim(tenantB.orgId, tenantB.storeId, orderBId, itemBId);

    // ---- Process ONLY org A's order ------------------------------------------
    await prisma.$transaction(async (tx) => {
      await estimateReturnOnClaim(orderAId, tx);
    });

    // ---- Assert org A received return-leg ESTIMATE rows ----------------------
    const orgAFees = await prisma.orderFee.findMany({
      where: {
        orderId: orderAId,
        organizationId: tenantA.orgId,
        feeType: { in: [...RETURN_FEE_TYPES] },
        source: 'ESTIMATE',
      },
      select: { feeType: true, direction: true, amountGross: true },
    });
    expect(orgAFees).toHaveLength(4);

    const byTypeA = new Map(orgAFees.map((f) => [f.feeType, f]));
    expect(byTypeA.get('REFUND_DEDUCTION')?.amountGross.toFixed(2)).toBe('1100.00');
    expect(byTypeA.get('COMMISSION_REFUND')?.amountGross.toFixed(2)).toBe('110.00');
    expect(byTypeA.get('COST_RETURN')?.amountGross.toFixed(2)).toBe('500.00');
    // RETURN_SHIPPING estimate: net 50.00 * 1.2 (VAT 20%) = 60.00
    expect(byTypeA.get('RETURN_SHIPPING')?.amountGross.toFixed(2)).toBe('60.00');

    const orderA = await prisma.order.findUniqueOrThrow({ where: { id: orderAId } });
    expect(orderA.estimatedNetProfit).not.toBeNull();
    expect(orderA.estimatedNetProfit!.toNumber()).toBeLessThan(0);

    // ---- Assert org B has ZERO return-leg rows and UNCHANGED profit ----------
    const orgBReturnFees = await prisma.orderFee.findMany({
      where: {
        orderId: orderBId,
        organizationId: tenantB.orgId,
        feeType: { in: [...RETURN_FEE_TYPES] },
      },
    });
    expect(orgBReturnFees).toHaveLength(0);

    // estimatedNetProfit must remain NULL — it was never set on org B's order
    const orderB = await prisma.order.findUniqueOrThrow({ where: { id: orderBId } });
    expect(orderB.estimatedNetProfit).toBeNull();

    // Double-check: org B's order has NO order fees at all (neither return legs
    // nor forward fees from applyEstimateOnOrderCreate, since it was never called)
    const orgBAllFees = await prisma.orderFee.findMany({
      where: { orderId: orderBId, organizationId: tenantB.orgId },
    });
    expect(orgBAllFees).toHaveLength(0);
  });
});
