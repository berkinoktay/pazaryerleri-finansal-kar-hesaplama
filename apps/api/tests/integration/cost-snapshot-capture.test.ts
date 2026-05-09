/**
 * Integration tests for the full cost-snapshot capture pipeline.
 *
 * Tests call upsertOrderWithSnapshot (the sync-worker's order persistence
 * function) which invokes captureCostSnapshot + recomputeOrderProfit in a
 * single transaction against a real DB.
 *
 * Covers every row in spec §5.8's edge-case table.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { upsertOrderWithSnapshot } from '../../../../apps/sync-worker/src/handlers/orders';

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
    const costProfile = await prisma.costProfile.create({
      data: {
        organizationId: orgId,
        name: p.name,
        type: 'COGS',
        amount: new Decimal(p.amount),
        currency: p.currency,
        vatRate: 0,
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

async function seedFxRate(currency: 'USD' | 'EUR', rateToTry: string) {
  const rateDate = new Date(Date.UTC(2026, 4, 8)); // 2026-05-08
  await prisma.fxRate.upsert({
    where: { currency_rateDate: { currency, rateDate } },
    create: { currency, rateDate, rateToTry: new Decimal(rateToTry), source: 'TCMB' },
    update: { rateToTry: new Decimal(rateToTry) },
  });
}

// ─── Shared raw-order builder ─────────────────────────────────────────────────

function makeRawOrder(
  platformOrderId: string,
  variantId: string | null,
  overrides: Partial<{
    totalAmount: string;
    commissionAmount: string;
    shippingCost: string;
    platformFee: string;
    vatAmount: string;
    quantity: number;
  }> = {},
) {
  return {
    platformOrderId,
    orderDate: new Date(),
    status: 'DELIVERED' as const,
    totalAmount: overrides.totalAmount ?? '200.00',
    commissionAmount: overrides.commissionAmount ?? '20.00',
    shippingCost: overrides.shippingCost ?? '10.00',
    platformFee: overrides.platformFee ?? '5.00',
    vatAmount: overrides.vatAmount ?? '0.00',
    lines: [
      {
        platformOrderLineId: randomUUID(),
        productVariantId: variantId,
        quantity: overrides.quantity ?? 1,
        unitPrice: '200.00',
        commissionRate: '10.00',
        commissionAmount: '20.00',
      },
    ],
  };
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
  it('variant with no profiles → snapshot stays null, netProfit stays null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // variant with NO cost profiles
    const { variant } = await buildVariantWithProfiles(org.id, store.id, []);

    const rawOrder = makeRawOrder(`order-${randomUUID()}`, variant.id);
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const order = await prisma.order.findFirst({ where: { storeId: store.id } });
    const item = await prisma.orderItem.findFirst({ where: { orderId: order!.id } });

    expect(item!.unitCostSnapshot).toBeNull();
    expect(order!.netProfit).toBeNull();
  });

  // §5.8 row 2: variant with profiles, FX rate stale (>2 days) — still proceeds
  it('variant with AUTO profile, stale FX rate → snapshot still captured with stale rate', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Seed a rate that is "stale" (3 days ago) — the service uses most-recent, no staleness rejection
    const staleDate = new Date(Date.UTC(2026, 4, 5)); // 2026-05-05 (3 days before "today" 2026-05-08)
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

    const rawOrder = makeRawOrder(`order-${randomUUID()}`, variant.id);
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const order = await prisma.order.findFirst({ where: { storeId: store.id } });
    const item = await prisma.orderItem.findFirst({ where: { orderId: order!.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item!.id },
    });

    expect(item!.unitCostSnapshot).not.toBeNull();
    expect(item!.unitCostSnapshot!.toFixed(2)).toBe('445.00'); // 10.00 × 44.50
    expect(components).toHaveLength(1);
    expect(components[0]!.fxRateSource).toBe('TCMB-2026-05-05');
    // netProfit = 200 - 20 - 10 - 5 - 445 = -280.00
    expect(order!.netProfit!.toFixed(2)).toBe('-280.00');
  });

  // §5.8 row 3: variant with AUTO profile, no FX rate ever fetched
  it('variant with AUTO USD profile, no FX rate → snapshot stays null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // NO fx_rates rows seeded
    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'USD COGS', currency: 'USD', amount: '10.00', fxRateMode: 'AUTO' },
    ]);

    const rawOrder = makeRawOrder(`order-${randomUUID()}`, variant.id);
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const order = await prisma.order.findFirst({ where: { storeId: store.id } });
    const item = await prisma.orderItem.findFirst({ where: { orderId: order!.id } });

    expect(item!.unitCostSnapshot).toBeNull();
    expect(order!.netProfit).toBeNull();
  });

  // §5.8 row 4: profile archived between sync arrival and snapshot capture
  it('archived profile is excluded from snapshot (treated as if detached)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // One archived TRY profile, no active profiles
    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      {
        name: 'Archived COGS',
        currency: 'TRY',
        amount: '30.00',
        fxRateMode: 'AUTO',
        archived: true,
      },
    ]);

    const rawOrder = makeRawOrder(`order-${randomUUID()}`, variant.id);
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const order = await prisma.order.findFirst({ where: { storeId: store.id } });
    const item = await prisma.orderItem.findFirst({ where: { orderId: order!.id } });

    expect(item!.unitCostSnapshot).toBeNull();
    expect(order!.netProfit).toBeNull();
  });

  // §5.8 row 5: re-sync same order (Trendyol replay) — snapshot untouched
  it('re-syncing the same order leaves snapshot untouched (idempotency)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'TRY COGS', currency: 'TRY', amount: '50.00', fxRateMode: 'AUTO' },
    ]);

    const platformOrderId = `order-${randomUUID()}`;
    const rawOrder = makeRawOrder(platformOrderId, variant.id);

    // First sync — snapshot captured
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const afterFirst = await prisma.orderItem.findFirst({
      where: { order: { storeId: store.id, platformOrderId } },
    });
    expect(afterFirst!.unitCostSnapshot).not.toBeNull();
    const firstSnapshot = afterFirst!.unitCostSnapshot!.toFixed(2);

    // Second sync (Trendyol replay) — must not re-capture or error
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const afterSecond = await prisma.orderItem.findFirst({
      where: { order: { storeId: store.id, platformOrderId } },
    });
    expect(afterSecond!.unitCostSnapshot!.toFixed(2)).toBe(firstSnapshot);

    // Only one OrderItem row (not two)
    const itemCount = await prisma.orderItem.count({
      where: { order: { platformOrderId } },
    });
    expect(itemCount).toBe(1);
  });

  // §5.8 row 6: order arrives, profiles attach later → past snapshot stays null
  it('order synced before profiles attached → snapshot stays null forever', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Sync order BEFORE profiles are attached
    const { variant } = await buildVariantWithProfiles(org.id, store.id, []);
    const platformOrderId = `order-${randomUUID()}`;
    await upsertOrderWithSnapshot(store.id, org.id, makeRawOrder(platformOrderId, variant.id));

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
        variantLinks: { create: [{ productVariantId: variant.id, organizationId: org.id }] },
      },
    });

    // Re-sync the same order — item already exists, skipped by findFirst check
    await upsertOrderWithSnapshot(store.id, org.id, makeRawOrder(platformOrderId, variant.id));

    const item = await prisma.orderItem.findFirst({
      where: { order: { platformOrderId } },
    });
    expect(item!.unitCostSnapshot).toBeNull(); // stays null — no backfill per spec §2 decision 6
  });

  // Happy path: all-TRY profile → snapshot + profit computed correctly
  it('TRY profiles → unitCostSnapshot and netProfit set in one transaction', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      { name: 'COGS A', currency: 'TRY', amount: '30.00', fxRateMode: 'AUTO' },
      { name: 'COGS B', currency: 'TRY', amount: '20.00', fxRateMode: 'AUTO' },
    ]);

    const rawOrder = makeRawOrder(`order-${randomUUID()}`, variant.id, {
      totalAmount: '200.00',
      commissionAmount: '20.00',
      shippingCost: '10.00',
      platformFee: '5.00',
    });
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const order = await prisma.order.findFirst({ where: { storeId: store.id } });
    const item = await prisma.orderItem.findFirst({ where: { orderId: order!.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item!.id },
    });

    // Total cost = 30 + 20 = 50 TRY (qty=1)
    expect(item!.unitCostSnapshot!.toFixed(2)).toBe('50.00');
    expect(components).toHaveLength(2);

    // netProfit = 200 - 20 - 10 - 5 - 50 = 115
    expect(order!.netProfit!.toFixed(2)).toBe('115.00');
  });

  // USD MANUAL profile
  it('USD MANUAL profile → captures profile.manualFxRate without querying fx_rates', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // NO fx_rates in DB — MANUAL should not need them
    const { variant } = await buildVariantWithProfiles(org.id, store.id, [
      {
        name: 'USD COGS MANUAL',
        currency: 'USD',
        amount: '10.00',
        fxRateMode: 'MANUAL',
        manualFxRate: '35.50',
      },
    ]);

    const rawOrder = makeRawOrder(`order-${randomUUID()}`, variant.id);
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const order = await prisma.order.findFirst({ where: { storeId: store.id } });
    const item = await prisma.orderItem.findFirst({ where: { orderId: order!.id } });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item!.id },
    });

    // 10.00 USD × 35.50 = 355.00 TRY
    expect(item!.unitCostSnapshot!.toFixed(2)).toBe('355.00');
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

    const rawOrder = makeRawOrder(`order-${randomUUID()}`, variant.id);
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const item = await prisma.orderItem.findFirst({
      where: { order: { storeId: store.id } },
    });
    const components = await prisma.orderItemCostSnapshotComponent.findMany({
      where: { orderItemId: item!.id },
    });

    // 10.00 × 45.19 = 451.90 TRY
    expect(item!.unitCostSnapshot!.toFixed(2)).toBe('451.90');
    expect(components[0]!.fxRateSource).toBe('TCMB-2026-05-08');
  });

  // Unattributed line item (no variant)
  it('order item with no productVariantId → snapshot stays null', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // variantId = null means unattributed line
    const rawOrder = makeRawOrder(`order-${randomUUID()}`, null);
    await upsertOrderWithSnapshot(store.id, org.id, rawOrder);

    const item = await prisma.orderItem.findFirst({
      where: { order: { storeId: store.id } },
    });

    expect(item!.unitCostSnapshot).toBeNull();
    expect(item!.productVariantId).toBeNull();
  });
});
