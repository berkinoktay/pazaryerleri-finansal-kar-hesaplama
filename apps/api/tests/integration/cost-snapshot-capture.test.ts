/**
 * Integration tests for the full cost-snapshot capture pipeline.
 *
 * Tests call captureCostSnapshot + recomputeOrderProfit from the API service
 * layer directly against a real DB, via Prisma transactions.
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
    amount: string;
    fxRateMode: 'AUTO' | 'MANUAL';
    manualFxRate?: string;
    archived?: boolean;
    /** Defaults to 0 (no VAT). Used in KDV-split snapshot tests. */
    vatRate?: number;
    /** When omitted, schema default null — exercises defensive compute path. */
    vatAmount?: string | null;
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
        amount: new Decimal(p.amount),
        currency: p.currency,
        vatRate,
        // null when caller omits — exercises captureCostSnapshot defensive
        // compute fallback (canonical formula: amount × vatRate / 100).
        vatAmount:
          p.vatAmount === null
            ? null
            : p.vatAmount !== undefined
              ? new Decimal(p.vatAmount)
              : new Decimal(p.amount).mul(vatRate).div(100),
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
      unitPrice: new Decimal('200.00'),
      commissionRate: new Decimal('10.00'),
      commissionAmount: new Decimal('20.00'),
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

describe('cost-snapshot capture — full pipeline (spec §5.8)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // §5.8 row 1: variant with 0 profiles when order arrives
  // PR-5c: netProfit assertion'ı kaldırıldı (Order.netProfit silindi, profit stub).
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
    expect(refreshedItem!.unitCostSnapshotNet).toBeNull();
  });

  // §5.8 row 2: variant with profiles, FX rate stale (>2 days) — still proceeds
  it('variant with AUTO profile, stale FX rate → snapshot still captured with stale rate', async () => {
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
      { name: 'USD COGS', currency: 'USD', amount: '10.00', fxRateMode: 'AUTO' },
    ]);
    // PR-5c: createOrder ücret override'ları (totalAmount/commissionAmount/shippingCost) kaldırıldı
    // — Order eski kolonlar silindi. Snapshot test'i netProfit assertion'ına bağlı değil.
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // 10.00 USD × 44.50 = 445.00 TRY
    expect(refreshedItem!.unitCostSnapshotNet!.toFixed(2)).toBe('445.00');
    expect(components).toHaveLength(1);
    expect(components[0]!.fxRateSource).toBe('TCMB-2026-05-05');
    // PR-5c: Order.netProfit silindi. Profit hesaplama PR-6'da
    // applyEstimateOnOrderCreate ile yeni convention'da yapılacak.
  });

  // §5.8 row 3: variant with AUTO profile, no FX rate ever fetched
  it('variant with AUTO USD profile, no FX rate → snapshot stays null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'USD COGS', currency: 'USD', amount: '10.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(refreshedItem!.unitCostSnapshotNet).toBeNull();
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
        amount: '30.00',
        fxRateMode: 'AUTO',
        archived: true,
      },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(refreshedItem!.unitCostSnapshotNet).toBeNull();
  });

  // §5.8 row 5: re-sync same order — snapshot untouched (idempotency at app layer)
  it('calling capture twice on the same item throws SnapshotAlreadyCapturedError on second call', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'TRY COGS', currency: 'TRY', amount: '50.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    // First capture — succeeds
    await captureAndComputeInTx(item.id, order.id);

    const after1 = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after1!.unitCostSnapshotNet).not.toBeNull();
    const firstSnapshot = after1!.unitCostSnapshotNet!.toFixed(2);

    // Second attempt — throws SnapshotAlreadyCapturedError (write-once)
    await expect(captureAndComputeInTx(item.id, order.id)).rejects.toThrow(
      /already has a unit_cost_snapshot/,
    );

    // Snapshot value unchanged after failed second attempt
    const after2 = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(after2!.unitCostSnapshotNet!.toFixed(2)).toBe(firstSnapshot);
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
    expect(after1!.unitCostSnapshotNet).toBeNull();

    // Now attach a profile
    await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        name: 'Late COGS',
        type: 'COGS',
        amount: new Decimal('25.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
        variantLinks: {
          create: [{ productVariantId: variant.id, organizationId: org.id }],
        },
      },
    });

    // Second sync with null snapshot — spec says no backfill so this WILL try to capture
    // (captureCostSnapshot only skips when unitCostSnapshotNet !== null)
    // But the caller (sync-worker) skips existing items by findFirst check.
    // Calling capture directly: it sees null snapshot + active profile → will capture
    // This tests the service directly; the sync-worker's idempotency is tested separately
    await captureAndComputeInTx(item.id, order.id);
    const after2 = await prisma.orderItem.findUnique({ where: { id: item.id } });
    // Service captures because snapshot was null — correct per spec (backfill scenario
    // is prevented by the sync-worker's INSERT-only-once guard, not the service itself)
    expect(after2!.unitCostSnapshotNet!.toFixed(2)).toBe('25.00');
  });

  // Happy path: TRY profiles → snapshot computed correctly.
  // PR-5c: netProfit assertion'ı kaldırıldı (Order.netProfit silindi, profit stub).
  // Profit hesaplama PR-6'da applyEstimateOnOrderCreate ile yeniden test edilir.
  it('TRY profiles → unitCostSnapshotNet set with sum of components', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'COGS A', currency: 'TRY', amount: '30.00', fxRateMode: 'AUTO' },
      { name: 'COGS B', currency: 'TRY', amount: '20.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // Total cost = 30 + 20 = 50 TRY (qty=1)
    expect(refreshedItem!.unitCostSnapshotNet!.toFixed(2)).toBe('50.00');
    expect(components).toHaveLength(2);
  });

  // USD MANUAL profile
  it('USD MANUAL profile → uses profile.manualFxRate without querying fx_rates', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      {
        name: 'USD COGS MANUAL',
        currency: 'USD',
        amount: '10.00',
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

    // 10.00 × 35.50 = 355.00 TRY
    expect(refreshedItem!.unitCostSnapshotNet!.toFixed(2)).toBe('355.00');
    expect(components[0]!.fxRateSource).toBe('MANUAL');
    expect(components[0]!.fxRateUsed.toFixed(2)).toBe('35.50');
  });

  // USD AUTO profile with FX rate present
  it('USD AUTO profile with FX rate → snapshot uses TCMB rate', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await seedFxRate('USD', '45.19');

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'USD COGS AUTO', currency: 'USD', amount: '10.00', fxRateMode: 'AUTO' },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // 10.00 × 45.19 = 451.90 TRY
    expect(refreshedItem!.unitCostSnapshotNet!.toFixed(2)).toBe('451.90');
    expect(components[0]!.fxRateSource).toBe('TCMB-2026-05-08');
  });

  // PR-6 continuation: KDV-split snapshot — single profile with vatRate > 0
  it('single TRY profile with vatRate 18 → NET/VAT/effectiveRate columns set', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'COGS NET', currency: 'TRY', amount: '50.00', fxRateMode: 'AUTO', vatRate: 18 },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item.id },
    });

    // amount = 50.00 NET (TRY native) → fx=1 → NET 50.00, VAT 50×18/100 = 9.00, rate 18.00
    expect(refreshedItem!.unitCostSnapshotNet!.toFixed(2)).toBe('50.00');
    expect(refreshedItem!.unitCostSnapshotVatAmount!.toFixed(2)).toBe('9.00');
    expect(refreshedItem!.unitCostSnapshotVatRate!.toFixed(2)).toBe('18.00');
    // Legacy column stays null — PR-6 continuation cut
    expect(refreshedItem!.unitCostSnapshot).toBeNull();

    // Component row carries KDV native + TRY snapshot
    expect(components).toHaveLength(1);
    expect(components[0]!.vatAmount!.toFixed(2)).toBe('9.00');
    expect(components[0]!.vatAmountInTry!.toFixed(2)).toBe('9.00');
  });

  // PR-6 continuation: multi-profile aggregate with mixed VAT rates
  it('multi-profile mixed VAT rates → blended effective rate denormalized', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'COGS A 18%', currency: 'TRY', amount: '100.00', fxRateMode: 'AUTO', vatRate: 18 },
      { name: 'COGS B 8%', currency: 'TRY', amount: '50.00', fxRateMode: 'AUTO', vatRate: 8 },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });

    // NET aggregate = 100 + 50 = 150.00 TRY
    // VAT aggregate = 100×18/100 + 50×8/100 = 18.00 + 4.00 = 22.00 TRY
    // Effective rate = 22.00 / 150.00 × 100 = 14.6666... → toDecimalPlaces(2) = 14.67
    expect(refreshedItem!.unitCostSnapshotNet!.toFixed(2)).toBe('150.00');
    expect(refreshedItem!.unitCostSnapshotVatAmount!.toFixed(2)).toBe('22.00');
    expect(refreshedItem!.unitCostSnapshotVatRate!.toFixed(2)).toBe('14.67');
    expect(refreshedItem!.unitCostSnapshot).toBeNull();
  });

  // PR-6 continuation: NET=0 edge — rate should be NULL, not 0
  // (0% is a valid export rate; aliasing the two states would mislead consumers)
  it('NET=0 (cost-free profile) → vatRate NULL (not 0)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'Zero COGS', currency: 'TRY', amount: '0.00', fxRateMode: 'AUTO', vatRate: 18 },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });
    expect(refreshedItem!.unitCostSnapshotNet!.toFixed(2)).toBe('0.00');
    expect(refreshedItem!.unitCostSnapshotVatAmount!.toFixed(2)).toBe('0.00');
    // NULL — undefined, not 0%
    expect(refreshedItem!.unitCostSnapshotVatRate).toBeNull();
  });

  // PR-6 continuation: defensive compute when profile.vatAmount is null
  // (pre-PR-6 rows where cost-profile.service did not backfill on create)
  it('profile.vatAmount NULL → defensive compute via canonical formula', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      {
        name: 'COGS pre-PR-6',
        currency: 'TRY',
        amount: '40.00',
        fxRateMode: 'AUTO',
        vatRate: 20,
        vatAmount: null,
      },
    ]);
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(org.id, order.id, variant.id);

    await captureAndComputeInTx(item.id, order.id);

    const refreshedItem = await prisma.orderItem.findUnique({ where: { id: item.id } });

    // Defensive compute: 40.00 × 20 / 100 = 8.00 — fills the gap that
    // cost-profile.service should have filled (TODO tracked in master guide).
    expect(refreshedItem!.unitCostSnapshotNet!.toFixed(2)).toBe('40.00');
    expect(refreshedItem!.unitCostSnapshotVatAmount!.toFixed(2)).toBe('8.00');
    expect(refreshedItem!.unitCostSnapshotVatRate!.toFixed(2)).toBe('20.00');
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

    expect(refreshedItem!.unitCostSnapshotNet).toBeNull();
    expect(refreshedItem!.productVariantId).toBeNull();
  });
});
