// Claims handler return-estimate backstop integration test — return-into-profit Task 7.
//
// Verifies that when processClaimsChunk processes a claim with at least one
// Accepted item, the trigger fires estimateReturnOnClaim inside the same
// transaction, producing the ESTIMATE return-leg OrderFee rows.
//
// Mirrors the DB-setup + fetcher-mock pattern from claims-handler.test.ts.
// Adds the seeding that estimateReturnOnClaim requires: FeeDefinitions (PSF /
// STOPPAGE / SHIPPING / RETURN_SHIPPING), a ShippingCarrier + DesiTariff, and
// a cost snapshot on the OrderItem.
//
// Requires: `supabase start` + `pnpm db:push`.
// Run: pnpm --filter sync-worker test:integration -- claims-return-estimate

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import type { FetchClaimsOpts, TrendyolClaim } from '@pazarsync/marketplace';

import { processClaimsChunk, type ClaimsFetchers } from '../../src/handlers/claims';

import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

// ─── Constants ────────────────────────────────────────────────────────────

const OUTBOUND_PACKAGE_ID = 73_001_234;
const ORDER_NUMBER = 'RET-TEST-001';
const PLATFORM_LINE_ID = 88_991_122n;
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
 * Seeds the FeeDefinition rows estimateReturnOnClaim and applyEstimateOnOrderCreate
 * need. Must be called after truncateAll() so there are no stale rows.
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
 * Creates a ShippingCarrier and a DesiTariff at desi=5 so RETURN_SHIPPING
 * can be estimated. Returns the carrierId for store.defaultShippingCarrierId.
 */
async function seedCarrierWithDesiTariff(): Promise<string> {
  const carrier = await prisma.shippingCarrier.create({
    data: {
      platform: 'TRENDYOL',
      externalId: Math.floor(Math.random() * 1_000_000),
      code: `TEST-RET-${randomUUID().slice(0, 6)}`,
      displayName: 'Test Kargo (Return Estimate)',
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

async function buildScenario(): Promise<ScenarioCtx> {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  await seedFeeDefinitions();
  const carrierId = await seedCarrierWithDesiTariff();

  const credentials = encryptCredentials({ supplierId: '5001', apiKey: 'k', apiSecret: 's' });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Return Estimate Test Store',
      platform: 'TRENDYOL',
      environment: 'SANDBOX',
      externalAccountId: '5001',
      credentials,
      status: 'ACTIVE',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrierId,
    },
  });

  // Per-unit: sale 1100 (VAT 10%), cost 500, commission 110 (VAT 20%).
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
      platformLineId: PLATFORM_LINE_ID,
    },
  });

  const syncLog = await prisma.syncLog.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      syncType: 'CLAIMS',
      status: 'RUNNING',
      startedAt: new Date(),
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
  await processClaimsChunk({ syncLog, cursor: null }, makeMockFetchers(claims));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('processClaimsChunk — return estimate backstop (Task 7)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // CI paylaşılan DB: bu test her senaryoda TEST-RET-* ShippingCarrier yaratıyor,
  // ama api truncateAll'ı shipping_carriers'ı SİLMEZ (reference data) → carrier'lar
  // birikip sonraki suite'in (api list-carriers) "tam 10 carrier" beklentisine sızar.
  // Suite sonunda temizle. stores.defaultShippingCarrierId FK'sı onDelete:SetNull →
  // carrier silinince store referansı null'lanır; önce desi tariff'leri (carrier FK) silinir.
  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM shipping_desi_tariffs WHERE carrier_id IN (SELECT id FROM shipping_carriers WHERE code LIKE 'TEST-%')`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM shipping_carriers WHERE code LIKE 'TEST-%'`);
  });

  it('fires estimateReturnOnClaim when the synced claim has an Accepted item — writes REFUND_DEDUCTION ESTIMATE fee', async () => {
    const ctx = await buildScenario();

    await runChunk(ctx.syncLogId, [makeAcceptedClaim()]);

    // The trigger must have fired: at minimum a REFUND_DEDUCTION ESTIMATE
    // fee row must exist for the order (proves estimateReturnOnClaim ran).
    const refundFee = await prisma.orderFee.findFirst({
      where: { orderId: ctx.orderId, feeType: 'REFUND_DEDUCTION', source: 'ESTIMATE' },
      select: { id: true, direction: true, amountGross: true },
    });
    expect(refundFee).not.toBeNull();
    expect(refundFee?.direction).toBe('DEBIT');
    // Full 1-unit return: refund = lineSaleGross (1100.00).
    expect(refundFee?.amountGross.toFixed(2)).toBe('1100.00');
  });

  it('writes all 4 ESTIMATE return-leg fees and makes estimatedNetProfit negative', async () => {
    const ctx = await buildScenario();

    await runChunk(ctx.syncLogId, [makeAcceptedClaim()]);

    const returnFees = await prisma.orderFee.findMany({
      where: {
        orderId: ctx.orderId,
        source: 'ESTIMATE',
        feeType: {
          in: ['REFUND_DEDUCTION', 'COMMISSION_REFUND', 'COST_RETURN', 'RETURN_SHIPPING'],
        },
      },
      select: { feeType: true, direction: true, amountGross: true },
    });

    // All 4 return legs must be written.
    expect(returnFees).toHaveLength(4);
    const byType = new Map(returnFees.map((f) => [f.feeType, f]));
    expect(byType.has('REFUND_DEDUCTION')).toBe(true);
    expect(byType.has('COMMISSION_REFUND')).toBe(true);
    expect(byType.has('COST_RETURN')).toBe(true);
    expect(byType.has('RETURN_SHIPPING')).toBe(true);

    // Directions follow the fold contract.
    expect(byType.get('REFUND_DEDUCTION')?.direction).toBe('DEBIT');
    expect(byType.get('COMMISSION_REFUND')?.direction).toBe('CREDIT');
    expect(byType.get('COST_RETURN')?.direction).toBe('CREDIT');
    expect(byType.get('RETURN_SHIPPING')?.direction).toBe('DEBIT');

    // estimatedNetProfit should be recomputed and be negative (return ate revenue).
    const order = await prisma.order.findUniqueOrThrow({ where: { id: ctx.orderId } });
    expect(order.estimatedNetProfit).not.toBeNull();
    expect(order.estimatedNetProfit!.toNumber()).toBeLessThan(0);
  });

  it('does NOT trigger for a claim with only WaitingInAction items — no ESTIMATE return fees', async () => {
    const ctx = await buildScenario();

    const waitingClaim = makeAcceptedClaim();
    for (const group of waitingClaim.items ?? []) {
      for (const ci of group.claimItems) {
        ci.claimItemStatus = { name: 'WaitingInAction' };
        ci.resolved = false;
        ci.acceptedBySeller = false;
      }
    }

    await runChunk(ctx.syncLogId, [waitingClaim]);

    // Claim is written, but no ESTIMATE return-leg fees (trigger did not fire).
    const claim = await prisma.orderClaim.findFirst({
      where: { trendyolClaimId: TRENDYOL_CLAIM_ID },
    });
    expect(claim).not.toBeNull();

    const returnFees = await prisma.orderFee.findMany({
      where: {
        orderId: ctx.orderId,
        source: 'ESTIMATE',
        feeType: {
          in: ['REFUND_DEDUCTION', 'COMMISSION_REFUND', 'COST_RETURN', 'RETURN_SHIPPING'],
        },
      },
    });
    expect(returnFees).toHaveLength(0);
  });

  it('re-scan with Accepted item is idempotent — ESTIMATE fees are updated, not duplicated', async () => {
    const ctx = await buildScenario();

    // First scan: trigger fires, fees are created.
    await runChunk(ctx.syncLogId, [makeAcceptedClaim()]);

    const countAfterFirst = await prisma.orderFee.count({
      where: {
        orderId: ctx.orderId,
        source: 'ESTIMATE',
        feeType: {
          in: ['REFUND_DEDUCTION', 'COMMISSION_REFUND', 'COST_RETURN', 'RETURN_SHIPPING'],
        },
      },
    });

    // Second scan: trigger fires again (idempotent — same 4 rows, no duplicates).
    await runChunk(ctx.syncLogId, [makeAcceptedClaim()]);

    const countAfterSecond = await prisma.orderFee.count({
      where: {
        orderId: ctx.orderId,
        source: 'ESTIMATE',
        feeType: {
          in: ['REFUND_DEDUCTION', 'COMMISSION_REFUND', 'COST_RETURN', 'RETURN_SHIPPING'],
        },
      },
    });

    expect(countAfterFirst).toBe(4);
    expect(countAfterSecond).toBe(4);
  });
});
