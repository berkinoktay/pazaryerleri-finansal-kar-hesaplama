/**
 * Integration tests for applyEstimateOnOrderCreate — return-leg coverage.
 *
 * Verifies that REFUND_DEDUCTION / COMMISSION_REFUND / COST_RETURN /
 * RETURN_SHIPPING OrderFee rows (source=ESTIMATE, confirmedAt=null) are folded
 * into the estimated profit formula (Task 4 of the return-into-profit epic).
 *
 * KEY DIFFERENCE from settled path: estimate folds ALL return legs (including
 * unconfirmed ESTIMATE source). confirmedAt is NOT a gate here.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 * Run: pnpm --filter @pazarsync/profit test:integration -- estimate-on-order-create-returns
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { applyEstimateOnOrderCreate } from '../estimate-on-order-create';

// ---- Shared DB helpers (inline) -----------------------------------------------

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
 * Seeds FeeDefinition rows required by applyEstimateOnOrderCreate.
 * PSF (PLATFORM_SERVICE) + STOPPAGE + SHIPPING definitions are needed so the
 * function can resolve them. We insert minimal rows (fixedAmountNet / rateOfSale
 * / defaultVatRate) matching the Trendyol platform.
 */
async function seedFeeDefinitions(): Promise<void> {
  // PSF — PLATFORM_SERVICE
  await prisma.feeDefinition.create({
    data: {
      platform: 'TRENDYOL',
      feeType: 'PLATFORM_SERVICE',
      displayName: 'Platform Hizmet Bedeli',
      calculationKind: 'FIXED',
      fixedAmountNet: new Decimal('9.16'), // 9.16 net * 1.2 = 10.99 gross
      defaultVatRate: new Decimal('20.00'),
      effectiveFrom: new Date('2024-01-01'),
    },
  });

  // STOPPAGE
  await prisma.feeDefinition.create({
    data: {
      platform: 'TRENDYOL',
      feeType: 'STOPPAGE',
      displayName: 'E-ticaret Stopaji',
      calculationKind: 'RATE_OF_SALE',
      rateOfSale: new Decimal('0.01'),
      defaultVatRate: new Decimal('0.00'),
      effectiveFrom: new Date('2024-01-01'),
    },
  });

  // SHIPPING
  await prisma.feeDefinition.create({
    data: {
      platform: 'TRENDYOL',
      feeType: 'SHIPPING',
      displayName: 'Kargo Bedeli',
      calculationKind: 'FORMULA',
      defaultVatRate: new Decimal('20.00'),
      effectiveFrom: new Date('2024-01-01'),
    },
  });
}

/**
 * Builds a minimal order with cost snapshots + sale aggregates filled in so
 * applyEstimateOnOrderCreate can compute a non-null estimated profit.
 *
 * saleGross=1100 (VAT 10%), item cost=500 (VAT 10%), commission=110 (VAT 20%).
 * No fastDeliveryType => PSF not SameDayShipping-discounted.
 * No shipping carrier set => shipping estimate will be skipped (logged only).
 */
async function buildBaseOrder(orgId: string, storeId: string): Promise<{ orderId: string }> {
  const order = await prisma.order.create({
    data: {
      organizationId: orgId,
      storeId,
      platformOrderId: `test-est-rtn-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: 'RETURNED',
      saleGross: new Decimal('1100.00'),
      saleVat: new Decimal('100.00'), // 1100 x 10/110
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
      refundedCommissionGross: new Decimal('0.00'),
      unitCostSnapshotGross: new Decimal('500.00'),
      unitCostSnapshotVatRate: new Decimal('10.00'),
    },
  });

  return { orderId: order.id };
}

// ---- Tests -------------------------------------------------------------------

describe('applyEstimateOnOrderCreate — return legs (estimate path)', () => {
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
   * Full single-item return: four return legs inserted as source=ESTIMATE,
   * confirmedAt=null. The estimate path must fold ALL of them (no confirmedAt
   * gate). After folding, sale/cost/commission are zeroed; remaining costs are
   * PSF + stoppage => estimatedNetProfit must be negative.
   *
   * Expected (simplified — shipping skipped because no carrier):
   *   After foldReturnLegs: sale=0/cost=0/commission=0
   *   RETURN_SHIPPING leg (DEBIT): 155.99 @ 20
   *   PSF ESTIMATE (upserted by fn): 10.99 @ 20 => gross=10.99
   *   STOPPAGE ESTIMATE: (1100-100) * 0.01 = 10.00 @ 0
   *   netProfit is negative.
   */
  it('full return (ESTIMATE legs, unconfirmed): estimatedNetProfit is negative', async () => {
    const { orgId, storeId } = await createSeedContext();
    await seedFeeDefinitions();
    const { orderId } = await buildBaseOrder(orgId, storeId);

    // Insert 4 return legs as ESTIMATE (confirmedAt=null — unconfirmed)
    const returnFees: {
      feeType: 'REFUND_DEDUCTION' | 'COMMISSION_REFUND' | 'COST_RETURN' | 'RETURN_SHIPPING';
      amountGross: Decimal;
      vatRate: Decimal;
    }[] = [
      {
        feeType: 'REFUND_DEDUCTION',
        amountGross: new Decimal('1100.00'),
        vatRate: new Decimal('10.00'),
      },
      {
        feeType: 'COMMISSION_REFUND',
        amountGross: new Decimal('110.00'),
        vatRate: new Decimal('20.00'),
      },
      {
        feeType: 'COST_RETURN',
        amountGross: new Decimal('500.00'),
        vatRate: new Decimal('10.00'),
      },
      {
        feeType: 'RETURN_SHIPPING',
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
          source: 'ESTIMATE',
          direction: 'DEBIT',
          amountGross: fee.amountGross,
          vatRate: fee.vatRate,
          // confirmedAt intentionally null => unconfirmed estimate
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(orderId, tx);
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estimatedNetProfit).not.toBeNull();

    // Must be negative: return zeroed revenue but costs (PSF + RETURN_SHIPPING + stoppage) remain
    expect(order.estimatedNetProfit!.toNumber()).toBeLessThan(0);
  });

  /**
   * Regression: an order with NO return legs must still produce a positive
   * estimated profit (the return-leg fold should be a no-op when no rows exist).
   */
  it('no return legs: estimatedNetProfit is positive (regression guard)', async () => {
    const { orgId, storeId } = await createSeedContext();
    await seedFeeDefinitions();
    const { orderId } = await buildBaseOrder(orgId, storeId);

    await prisma.$transaction(async (tx) => {
      await applyEstimateOnOrderCreate(orderId, tx);
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.estimatedNetProfit).not.toBeNull();
    expect(order.estimatedNetProfit!.toNumber()).toBeGreaterThan(0);
  });
});
