import { prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { intakeOrder } from '@pazarsync/order-sync';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createCostProfile, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const BARCODE = 'EAN13-INTAKE-001';

// MappedOrder with real Date objects (intakeOrder receives the in-memory DTO,
// not the JSON round-trip). orderDate drives the today/past-day routing.
function buildMapped(over: {
  platformOrderId: string;
  orderDate: Date;
  barcode?: string;
  status?: MappedOrder['status'];
  dematerialized?: boolean;
}): MappedOrder {
  return {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: `ord-${over.platformOrderId}`,
    orderDate: over.orderDate,
    lastModifiedDate: over.orderDate,
    status: over.status ?? 'PROCESSING',
    dematerialized: over.dematerialized ?? false,
    saleSubtotalNet: '84.75',
    saleVatTotal: '15.25',
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    fastDelivery: false,
    micro: false,
    lines: [
      {
        barcode: over.barcode ?? BARCODE,
        quantity: 1,
        unitPriceNet: '84.75',
        unitVatRate: '18',
        unitVatAmount: '15.25',
        grossCommissionAmountNet: '12.71',
        grossCommissionVatAmount: '2.29',
        sellerDiscountNet: '0',
        sellerDiscountVatAmount: '0',
        commissionRate: '15',
      },
    ],
  };
}

// Seed a variant. withCost=false → cost_missing; withCost=true → calculable.
async function seedVariant(
  orgId: string,
  storeId: string,
  barcode: string,
  withCost: boolean,
): Promise<void> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Intake Test Product',
    },
  });
  const costLink = withCost
    ? {
        costProfileLinks: {
          create: {
            organizationId: orgId,
            profileId: (await createCostProfile(orgId, { amount: '40.00' })).id,
          },
        },
      }
    : {};
  await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      ...costLink,
    },
  });
}

// 36h back so the date is unambiguously a previous business day even if the test
// runs just after midnight (the routing reads getBusinessDate(orderDate)).
const PAST_DAY_MS = 36 * 60 * 60 * 1000;

describe('intakeOrder — shared intake routing (Slice 0)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('calculable → persists to orders (no buffer)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, true);

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'calc-1', orderDate: new Date() }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'calculable' });
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('cost-missing + today → buffers (PENDING), no orders row', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'today-1', orderDate: new Date() }),
    });

    expect(outcome).toEqual({ kind: 'buffered' });
    const entries = await prisma.livePerformanceBuffer.findMany({ where: { storeId: store.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe('PENDING');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('cost-missing + today, duplicate → buffered_deduped (single entry)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);
    const mapped = buildMapped({ platformOrderId: 'dup-1', orderDate: new Date() });

    const first = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    const second = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });

    expect(first).toEqual({ kind: 'buffered' });
    expect(second).toEqual({ kind: 'buffered_deduped' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(1);
  });

  it('cost-missing + past-day → persists to orders with null profit (no buffer)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'late-1',
        orderDate: new Date(Date.now() - PAST_DAY_MS),
      }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'cost_missing_past_day' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('late-1');
    expect(order.estimatedNetProfit).toBeNull();
  });

  it('cost-missing + today but already in orders → persists (idempotent), never buffers', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);
    const mapped = buildMapped({ platformOrderId: 'exists-1', orderDate: new Date() });
    // Pre-existing orders row (e.g. costed earlier, profile later archived).
    await prisma.order.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformOrderId: 'exists-1',
        platformOrderNumber: 'ord-exists-1',
        orderDate: new Date(),
        status: 'PROCESSING',
      },
    });

    const outcome = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'already_in_orders' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
  });

  it('variant_not_found → skipped, nothing written', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // No variant seeded → barcode resolves to no variant.

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'novar-1',
        orderDate: new Date(),
        barcode: 'UNKNOWN-XYZ',
      }),
    });

    expect(outcome).toEqual({
      kind: 'skipped',
      reason: 'variant_not_found',
      barcode: 'UNKNOWN-XYZ',
    });
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('already-in-orders guard is org/store-scoped — org B never matches org A order', async () => {
    const orgA = await createOrganization();
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await seedVariant(orgB.id, storeB.id, BARCODE, false); // org B variant, cost-missing

    // Org A already has an order with the SAME platformOrderId, in its own store.
    await prisma.order.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformOrderId: 'shared-id',
        platformOrderNumber: 'ord-shared',
        orderDate: new Date(),
        status: 'PROCESSING',
      },
    });

    // Org B intake for the same platformOrderId, today, cost-missing.
    const outcome = await intakeOrder({
      storeId: storeB.id,
      organizationId: orgB.id,
      mapped: buildMapped({ platformOrderId: 'shared-id', orderDate: new Date() }),
    });

    // Guard scoped to org B / store B → does NOT see org A's order → buffers under B.
    expect(outcome).toEqual({ kind: 'buffered' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: storeB.id } })).toBe(1);
    // Org A order untouched (no cross-tenant upsert), org B has no orders row.
    expect(await prisma.order.count({ where: { organizationId: orgA.id } })).toBe(1);
    expect(await prisma.order.count({ where: { organizationId: orgB.id } })).toBe(0);
  });

  // ── Split-ghost dematerialization + cancel routing (research 2026-06-09) ──

  it('dematerialized (UnPacked) → deletes the existing orders row (split ghost)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, true);

    // The pre-split package was persisted as a normal order…
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'split-ghost-1', orderDate: new Date() }),
    });
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);

    // …then Trendyol reports it UnPacked (split happened) → row must vanish.
    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'split-ghost-1',
        orderDate: new Date(),
        status: 'CANCELLED',
        dematerialized: true,
      }),
    });

    expect(outcome).toEqual({
      kind: 'dematerialized',
      deletedOrder: true,
      deletedBufferEntries: 0,
    });
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('dematerialized (UnPacked) → clears the matching buffer entry', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);

    // Cost-missing today → the pre-split package landed in the buffer…
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'split-ghost-2', orderDate: new Date() }),
    });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(1);

    // …then the split dissolves it → buffer row must vanish too.
    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'split-ghost-2',
        orderDate: new Date(),
        status: 'CANCELLED',
        dematerialized: true,
      }),
    });

    expect(outcome).toEqual({
      kind: 'dematerialized',
      deletedOrder: false,
      deletedBufferEntries: 1,
    });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('dematerialized scope is org/store-bound — never deletes another tenant row', async () => {
    const orgA = await createOrganization();
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    await prisma.order.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformOrderId: 'ghost-shared',
        platformOrderNumber: 'ord-ghost-shared',
        orderDate: new Date(),
        status: 'PROCESSING',
      },
    });

    const outcome = await intakeOrder({
      storeId: storeB.id,
      organizationId: orgB.id,
      mapped: buildMapped({
        platformOrderId: 'ghost-shared',
        orderDate: new Date(),
        status: 'CANCELLED',
        dematerialized: true,
      }),
    });

    expect(outcome).toEqual({
      kind: 'dematerialized',
      deletedOrder: false,
      deletedBufferEntries: 0,
    });
    // Org A's order survives — deletion is tenant-scoped.
    expect(await prisma.order.count({ where: { organizationId: orgA.id } })).toBe(1);
  });

  it('CANCELLED → purges the buffer entry and persists an audit row', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);

    // Cost-missing today → buffered (counting volume on the live page)…
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'cancel-1', orderDate: new Date() }),
    });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(1);

    // …then the customer cancels → buffer must empty, order persists as audit.
    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'cancel-1',
        orderDate: new Date(),
        status: 'CANCELLED',
      }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'cancelled_audit' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('cancel-1');
    expect(order.status).toBe('CANCELLED');
  });
});
