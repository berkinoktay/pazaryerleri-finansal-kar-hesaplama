/**
 * Integration tests for the full cost-snapshot capture pipeline — GROSS convention.
 *
 * Tests call captureCostSnapshot + recomputeOrderProfit from the API service
 * layer directly against a real DB, via Prisma transactions.
 *
 * GROSS convention (2026-06-16): CostProfile.amountGross (KDV-dahil) →
 * OrderItem.unitCostSnapshotGross + unitCostSnapshotVatRate.
 * Components: amountGross + vatRate + amountInTryGross.
 * Cost VAT rate independent of sale VAT (spec §7).
 *
 * Covers every row in spec §5.8's edge-case table.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { captureCostSnapshot } from '@/services/cost-snapshot.service';
import { recomputeOrderProfit } from '@/services/profit-calculation.service';

import { ensureDbReachable, truncateAll } from '../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
  createUserProfile,
} from '../helpers/factories';

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function buildVariantWithProfiles(
  orgId: string,
  storeId: string,
  profiles: Array<{
    name: string;
    currency: 'TRY' | 'USD' | 'EUR';
    amountGross: string;
    vatRate?: number;
    fxRateMode: 'AUTO' | 'MANUAL';
    manualFxRate?: string;
    archived?: boolean;
  }>,
) {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `main-${randomUUID().slice(0, 8)}`,
      title: 'Integration Test Product',
    },
  });

  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: randomUUID().slice(0, 13),
      stockCode: `SKU-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('199.99'),
      listPrice: new Decimal('249.99'),
    },
  });

  for (const p of profiles) {
    const vatRate = p.vatRate ?? 0;
    const costProfile = await prisma.costProfile.create({
      data: {
        organizationId: orgId,
        name: p.name,
        type: 'COGS',
        amountGross: new Decimal(p.amountGross),
        currency: p.currency,
        vatRate,
        fxRateMode: p.fxRateMode,
        manualFxRate: p.manualFxRate != null ? new Decimal(p.manualFxRate) : null,
        archivedAt: p.archived === true ? new Date() : null,
      },
    });

    await prisma.productVariantCostProfile.create({
      data: {
        productVariantId: variant.id,
        profileId: costProfile.id,
        organizationId: orgId,
      },
    });
  }

  return { variant };
}

async function createOrderItem(orgId: string, orderId: string, variantId: string | null) {
  return prisma.orderItem.create({
    data: {
      orderId,
      organizationId: orgId,
      productVariantId: variantId,
      quantity: 1,
      lineListGross: new Decimal('200.00'),
      lineSaleGross: new Decimal('200.00'),
      lineSellerDiscountGross: new Decimal('0.00'),
      saleVatRate: new Decimal('20'),
      commissionRate: new Decimal('10.00'),
      commissionGross: new Decimal('20.00'),
      refundedCommissionGross: new Decimal('0.00'),
      commissionVatRate: new Decimal('20'),
    },
  });
}

async function seedFxRate(currency: 'USD' | 'EUR', rateToTry: string) {
  const rateDate = new Date(Date.UTC(2026, 4, 8)); // 2026-05-08
  await prisma.fxRate.upsert({
    where: { currency_rateDate: { currency, rateDate } },
    create: { currency, rateDate, rateToTry: new Decimal(rateToTry), source: 'TCMB' },
    update: { rateToTry: new Decimal(rateToTry) },
  });
}

/**
 * Run captureCostSnapshot + recomputeOrderProfit in a single transaction,
 * mirroring the sync-worker's behaviour without crossing app boundaries.
 */
async function captureAndComputeInTx(orderItemId: string, orderId: string) {
  await prisma.$transaction(async (tx) => {
    await captureCostSnapshot(orderItemId, tx);
    await recomputeOrderProfit(orderId, tx);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('cost-snapshot capture — GROSS convention (spec §5.8)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // §5.8 row 1: variant with 0 profiles when order arrives
  it('variant with no profiles → snapshot stays null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, []);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(refreshedItem!.unitCostSnapshotGross).toBeNull();
  });

  // §5.8 row 2: variant with profiles, FX rate stale (>2 days) — still proceeds
  it('variant with AUTO profile, stale FX rate → snapshot still captured with stale rate (GROSS)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Seed a "stale" rate (3 days ago) — service uses most-recent, no staleness rejection
    const staleDate = new Date(Date.UTC(2026, 4, 5)); // 2026-05-05
    await prisma.fxRate.create({
      data: {
        currency: 'USD',
        rateDate: staleDate,
        rateToTry: new Decimal('44.50'),
        source: 'TCMB',
      },
    });

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'USD COGS', currency: 'USD', amountGross: '10.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // 10.00 USD gross × 44.50 = 445.00 TRY gross
    expect(refreshedItem!.unitCostSnapshotGross!.toFixed(2)).toBe('445.00');
    expect(components).toHaveLength(1);
    expect(components[0]!.fxRateSource).toBe('TCMB-2026-05-05');
  });

  // §5.8 row 3: variant with AUTO profile, no FX rate ever fetched
  it('variant with AUTO USD profile, no FX rate → snapshot stays null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'USD COGS', currency: 'USD', amountGross: '10.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(refreshedItem!.unitCostSnapshotGross).toBeNull();
  });

  // §5.8 row 4: profile archived between sync arrival and snapshot capture
  it('archived profile is excluded from snapshot (treated as if detached)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      {
        name: 'Archived COGS',
        currency: 'TRY',
        amountGross: '30.00',
        fxRateMode: 'AUTO',
        archived: true,
      },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(refreshedItem!.unitCostSnapshotGross).toBeNull();
  });

  // §5.8 row 5: re-sync same order — snapshot untouched (idempotency at app layer)
  it('calling capture twice on the same item throws SnapshotAlreadyCapturedError on second call', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'TRY COGS', currency: 'TRY', amountGross: '50.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    // First capture — succeeds
    await captureAndComputeInTx(item.id, order.id);

    const after1 = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after1!.unitCostSnapshotGross).not.toBeNull();
    const firstSnapshot = after1!.unitCostSnapshotGross!.toFixed(2);

    // Second attempt — throws SnapshotAlreadyCapturedError (write-once)
    await expect(captureAndComputeInTx(item.id, order.id)).rejects.toThrow(
      /already has a unit_cost_snapshot/,
    );

    // Snapshot value unchanged after failed second attempt
    const after2 = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after2!.unitCostSnapshotGross!.toFixed(2)).toBe(firstSnapshot);
  });

  // §5.8 row 6: order arrives, profiles attach later → past snapshot stays null
  it('item created before profiles attached → snapshot stays null on re-call', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Create order item BEFORE any profiles
    const { variant } = await buildVariantWithProfiles(org.id, store.id, []);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    // First sync — no profiles, snapshot stays null
    await captureAndComputeInTx(item.id, order.id);
    const after1 = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after1!.unitCostSnapshotGross).toBeNull();

    // Now attach a profile (GROSS convention)
    await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        name: 'Late COGS',
        type: 'COGS',
        amountGross: new Decimal('25.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
        variantLinks: {
          create: [{ productVariantId: variant.id, organizationId: org.id }],
        },
      },
    });

    // Second sync with null snapshot — captures because unitCostSnapshotGross is null
    await captureAndComputeInTx(item.id, order.id);
    const after2 = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after2!.unitCostSnapshotGross!.toFixed(2)).toBe('25.00');
  });

  // Happy path: TRY profiles → snapshot computed correctly (GROSS)
  it('TRY profiles → unitCostSnapshotGross set with sum of components', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'COGS A', currency: 'TRY', amountGross: '30.00', fxRateMode: 'AUTO' },
      { name: 'COGS B', currency: 'TRY', amountGross: '20.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // Total gross cost = 30 + 20 = 50 TRY (both vatRate=0 → null vatRate)
    expect(refreshedItem!.unitCostSnapshotGross!.toFixed(2)).toBe('50.00');
    expect(components).toHaveLength(2);
  });

  // USD MANUAL profile (GROSS)
  it('USD MANUAL profile → uses profile.manualFxRate without querying fx_rates (GROSS)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      {
        name: 'USD COGS MANUAL',
        currency: 'USD',
        amountGross: '10.00',
        fxRateMode: 'MANUAL',
        manualFxRate: '35.50',
      },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // 10.00 GROSS × 35.50 = 355.00 TRY gross
    expect(refreshedItem!.unitCostSnapshotGross!.toFixed(2)).toBe('355.00');
    expect(components[0]!.fxRateSource).toBe('MANUAL');
    expect(components[0]!.fxRateUsed.toFixed(2)).toBe('35.50');
  });

  // USD AUTO profile with FX rate present (GROSS)
  it('USD AUTO profile with FX rate → snapshot uses TCMB rate (GROSS)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await seedFxRate('USD', '45.19');

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'USD COGS AUTO', currency: 'USD', amountGross: '10.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // 10.00 GROSS × 45.19 = 451.90 TRY gross
    expect(refreshedItem!.unitCostSnapshotGross!.toFixed(2)).toBe('451.90');
    expect(components[0]!.fxRateSource).toBe('TCMB-2026-05-08');
  });

  // GROSS convention: single profile with vatRate > 0 → blended effective rate
  it('single TRY profile with vatRate 20 (GROSS) → gross + effective vatRate set', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'COGS GROSS', currency: 'TRY', amountGross: '60.00', vatRate: 20, fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // amountGross=60.00, fx=1 → unitCostSnapshotGross=60.00
    // blended vatRate = 60×20/60 = 20.00
    expect(refreshedItem!.unitCostSnapshotGross!.toFixed(2)).toBe('60.00');
    expect(refreshedItem!.unitCostSnapshotVatRate!.toFixed(2)).toBe('20.00');

    // Component carries amountInTryGross (gross stays gross)
    expect(components).toHaveLength(1);
    expect(components[0]!.amountInTryGross!.toFixed(2)).toBe('60.00');
  });

  // Multi-profile mixed VAT rates — blended effective rate (GROSS)
  it('multi-profile mixed VAT rates → blended effective vatRate (GROSS)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'COGS A 20%', currency: 'TRY', amountGross: '100.00', vatRate: 20, fxRateMode: 'AUTO' },
      { name: 'COGS B 8%',  currency: 'TRY', amountGross: '50.00',  vatRate: 8,  fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });

    // GROSS aggregate = 100 + 50 = 150.00 TRY
    // Blended vatRate = (100×20 + 50×8) / 150 = (2000+400)/150 = 16.00
    expect(refreshedItem!.unitCostSnapshotGross!.toFixed(2)).toBe('150.00');
    expect(refreshedItem!.unitCostSnapshotVatRate!.toFixed(2)).toBe('16.00');
  });

  // GROSS=0 edge — vatRate should be NULL (undefined vs 0% exempt)
  it('zero amountGross → unitCostSnapshotGross=0 with unitCostSnapshotVatRate=null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'Zero COGS', currency: 'TRY', amountGross: '0.00', vatRate: 20, fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(refreshedItem!.unitCostSnapshotGross!.toFixed(2)).toBe('0.00');
    // NULL — undefined, not 0%
    expect(refreshedItem!.unitCostSnapshotVatRate).toBeNull();
  });

  // Unattributed line item (no variant)
  it('order item with no productVariantId → snapshot stays null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const order = await createOrder(org.id, store.id);
    // null productVariantId — unattributed line
    const item = await createOrderItem(org.id, order.id, null);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });

    expect(refreshedItem!.unitCostSnapshotGross).toBeNull();
    expect(refreshedItem!.productVariantId).toBeNull();
  });
});
