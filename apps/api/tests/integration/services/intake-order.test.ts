import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';
import type { MappedOrder } from '@pazarsync/marketplace';
import { intakeOrder } from '@pazarsync/order-sync';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

// Narrow a buffer row's mappedOrder/rawPayload JSONB so tests can read fields
// without a type assertion (repo rule: no `as`).
function readBufferJson(value: Prisma.JsonValue): Record<string, Prisma.JsonValue | undefined> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected buffer JSONB to be an object');
  }
  return value;
}

const BARCODE = 'EAN13-INTAKE-001';

// MappedOrder with real Date objects (intakeOrder receives the in-memory DTO,
// not the JSON round-trip). orderDate drives the today/past-day routing.
function buildMapped(over: {
  platformOrderId: string;
  orderDate: Date;
  /** Marketplace lastModifiedDate — drives the out-of-order / refresh comparison.
   * Defaults to orderDate when omitted (the pre-existing tests' behavior). */
  lastModifiedDate?: Date;
  barcode?: string;
  status?: MappedOrder['status'];
  dematerialized?: boolean;
  /** Multi-line orders: each entry clones the single-line template below. */
  lines?: Array<{ barcode: string; platformLineId: string }>;
}): MappedOrder {
  // GROSS konvansiyon (2026-06-16): MappedOrderLine gross alanlar.
  // lineSaleGross 100 = net 84.75 + KDV 15.25 (%18). commissionGross 15 (gross).
  const lineTemplate = {
    quantity: 1,
    lineListGross: '100',
    lineSaleGross: '100',
    lineSellerDiscountGross: '0',
    saleVatRate: '18',
    commissionRate: '15',
    commissionGross: '15',
    refundedCommissionGross: '0',
    commissionVatRate: '20',
    categoryId: null,
    commissionKnown: true,
  };
  return {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: `ord-${over.platformOrderId}`,
    orderDate: over.orderDate,
    lastModifiedDate: over.lastModifiedDate ?? over.orderDate,
    status: over.status ?? 'PROCESSING',
    dematerialized: over.dematerialized ?? false,
    // GROSS konvansiyon: saleGross 100 = net 84.75 + KDV 15.25.
    saleGross: '100',
    saleVat: '15.25',
    listGross: '100',
    sellerDiscountGross: '0',
    promotionDisplays: null,
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    actualShipDate: null,
    fastDelivery: false,
    fastDeliveryType: null,
    micro: false,
    estimatedDeliveryStartDate: null,
    estimatedDeliveryEndDate: null,
    cargoProviderName: null,
    cargoTrackingNumber: null,
    cargoDeci: null,
    usesSellerCargoAgreement: false,
    platformCreatedBy: null,
    originShipmentDate: null,
    lines:
      over.lines !== undefined
        ? over.lines.map((line) => ({
            ...lineTemplate,
            barcode: line.barcode,
            platformLineId: line.platformLineId,
          }))
        : [
            {
              ...lineTemplate,
              barcode: over.barcode ?? BARCODE,
              platformLineId: null,
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
            profileId: (await createCostProfile(orgId, { amountGross: '40.00' })).id,
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

  // ── Buffer snapshot refresh: a re-delivery of a still-PENDING buffered order ──
  // must advance the stored snapshot when it is newer, so the eventual promote
  // writes the freshest status/fields instead of freezing at the first event.

  it('(e) PENDING buffer + newer event → snapshot refreshed (refreshed: true), identity columns untouched', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false); // cost-missing → buffer
    const today = new Date();
    const older = new Date(today.getTime() - 60_000);

    const first = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'refresh-1',
        orderDate: today,
        lastModifiedDate: older,
        status: 'PROCESSING',
      }),
    });
    expect(first).toEqual({ kind: 'buffered' });
    const before = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { storeId: store.id },
    });

    const second = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'refresh-1',
        orderDate: today,
        lastModifiedDate: today,
        status: 'SHIPPED',
      }),
    });
    expect(second).toEqual({ kind: 'buffered_deduped', refreshed: true });

    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(1);
    const after = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { storeId: store.id },
    });
    // Snapshot advanced to the newer event (both mapped + raw).
    const mapped = readBufferJson(after.mappedOrder);
    expect(mapped['lastModifiedDate']).toBe(today.toISOString());
    expect(mapped['status']).toBe('SHIPPED');
    expect(readBufferJson(after.rawPayload)['lastModifiedDate']).toBe(today.toISOString());
    // Identity columns are left untouched by the refresh.
    expect(after.status).toBe('PENDING');
    expect(after.orderDate.toISOString()).toBe(before.orderDate.toISOString());
  });

  it('(f) PENDING buffer + older event → NOT refreshed (plain buffered_deduped), snapshot preserved', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);
    const today = new Date();
    const older = new Date(today.getTime() - 60_000);

    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'refresh-2',
        orderDate: today,
        lastModifiedDate: today, // newer event lands first
        status: 'SHIPPED',
      }),
    });
    const second = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'refresh-2',
        orderDate: today,
        lastModifiedDate: older, // stale re-delivery
        status: 'PROCESSING',
      }),
    });

    expect(second).toEqual({ kind: 'buffered_deduped' });
    const entry = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { storeId: store.id },
    });
    const mapped = readBufferJson(entry.mappedOrder);
    // Snapshot still holds the newer T2 event — the stale one did not overwrite it.
    expect(mapped['lastModifiedDate']).toBe(today.toISOString());
    expect(mapped['status']).toBe('SHIPPED');
  });

  it('(g) legacy buffer snapshot without lastModifiedDate → treated as older, refreshed', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);
    const today = new Date();

    // Pre-existing PENDING row whose mappedOrder JSONB carries no lastModifiedDate
    // (legacy shape — the factory default is `{ lines: [] }`).
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'legacy-1',
      status: 'PENDING',
    });

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'legacy-1',
        orderDate: today,
        lastModifiedDate: today,
        status: 'SHIPPED',
      }),
    });

    expect(outcome).toEqual({ kind: 'buffered_deduped', refreshed: true });
    const entry = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { storeId: store.id },
    });
    const mapped = readBufferJson(entry.mappedOrder);
    expect(mapped['lastModifiedDate']).toBe(today.toISOString());
    expect(mapped['status']).toBe('SHIPPED');
  });

  it('(h) PROMOTING buffer is never rewritten — plain buffered_deduped, snapshot untouched', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);
    const today = new Date();

    // A row already claimed by the promote worker (status past PENDING).
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'promoting-1',
      status: 'PROMOTING',
    });

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'promoting-1',
        orderDate: today,
        lastModifiedDate: today,
        status: 'SHIPPED',
      }),
    });

    expect(outcome).toEqual({ kind: 'buffered_deduped' });
    const entry = await prisma.livePerformanceBuffer.findFirstOrThrow({
      where: { storeId: store.id },
    });
    expect(entry.status).toBe('PROMOTING');
    // The incoming event never touched the snapshot (still the legacy default shape).
    expect(readBufferJson(entry.mappedOrder)['lastModifiedDate']).toBeUndefined();
  });

  it('cost-missing + past-day → persists PROFIT-EXCLUDED (no later cost entry)', async () => {
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

    expect(outcome).toEqual({ kind: 'persisted', reason: 'excluded_late_arrival' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('late-1');
    expect(order.estimatedNetProfit).toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    expect(order.profitExcludedAt).not.toBeNull();
    // Fee de yazılmaz: kâr-dışı sipariş PSF/Stopaj ESTIMATE satırı taşımaz.
    expect(await prisma.orderFee.count({ where: { orderId: order.id } })).toBe(0);
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

  it('unmatched variant + today order → buffered (revenue visible, cost waits)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // No variant seeded → barcode resolves to no variant.

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'novar-today',
        orderDate: new Date(),
        barcode: 'UNKNOWN-XYZ',
      }),
    });

    expect(outcome).toEqual({ kind: 'buffered' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(1);
  });

  it('unmatched variant + past-day order → persisted with a null-variant item carrying the barcode', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'novar-past',
        orderDate: new Date(Date.now() - PAST_DAY_MS),
        barcode: 'UNKNOWN-XYZ',
      }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'excluded_late_arrival' });
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { order: { storeId: store.id, platformOrderId: 'novar-past' } },
    });
    expect(item.productVariantId).toBeNull();
    expect(item.barcode).toBe('UNKNOWN-XYZ');

    // Legacy-key idempotency: the template line carries NO platformLineId, so a
    // re-scan dedupes on the (orderId, null-variant) fallback — still one item.
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'novar-past',
        orderDate: new Date(Date.now() - PAST_DAY_MS),
        barcode: 'UNKNOWN-XYZ',
      }),
    });
    expect(
      await prisma.orderItem.count({
        where: { order: { storeId: store.id, platformOrderId: 'novar-past' } },
      }),
    ).toBe(1);
  });

  it('mixed order past-day: BOTH lines persist with frozen money — order is excluded as a whole (K5)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, 'EAN13-MIX-OK', true); // variant + cost profile

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'mixed-1',
        orderDate: new Date(Date.now() - PAST_DAY_MS),
        lines: [
          { barcode: 'EAN13-MIX-OK', platformLineId: '8001' },
          { barcode: 'UNKNOWN-MIX', platformLineId: '8002' },
        ],
      }),
    });

    // One unmatched line makes the order cost_missing — both lines persist, but
    // the order is EXCLUDED atomically (decision K5): even the costed line's
    // snapshot stays frozen (null). Identity (variant FK) is still linked.
    expect(outcome).toEqual({ kind: 'persisted', reason: 'excluded_late_arrival' });
    const items = await prisma.orderItem.findMany({
      where: { order: { storeId: store.id, platformOrderId: 'mixed-1' } },
      orderBy: { barcode: 'asc' },
    });
    expect(items).toHaveLength(2);
    const [matched, unmatched] = items;
    expect(matched!.barcode).toBe('EAN13-MIX-OK');
    expect(matched!.productVariantId).not.toBeNull();
    // Excluded order carries NO money snapshot — even on the costed line.
    expect(matched!.unitCostSnapshotGross).toBeNull();
    expect(unmatched!.barcode).toBe('UNKNOWN-MIX');
    expect(unmatched!.productVariantId).toBeNull();
    expect(unmatched!.unitCostSnapshotGross).toBeNull();
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'mixed-1' },
    });
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
  });

  it('legacy item without platformLineId is matched (not duplicated) by a re-delivery carrying one, and backfilled', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false); // variant resolves, no cost
    const past = new Date(Date.now() - PAST_DAY_MS);

    // 1st intake: template line has NO platformLineId (pre-PR-8 / legacy buffer
    // JSONB shape) → item stored with platformLineId NULL.
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'transition-1', orderDate: past }),
    });

    // 2nd intake: the same physical line now carries its platform line id
    // (e.g. a Delivered webhook after the mapper upgrade). Must dedupe against
    // the stored NULL row — not insert a twin — and self-heal the id.
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'transition-1',
        orderDate: past,
        lines: [{ barcode: BARCODE, platformLineId: '7001' }],
      }),
    });

    const items = await prisma.orderItem.findMany({
      where: { order: { storeId: store.id, platformOrderId: 'transition-1' } },
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.platformLineId).toBe(7001n);
  });

  it('two different unmatched lines in one order both persist, and re-intake stays idempotent', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const mapped = buildMapped({
      platformOrderId: 'novar-two-lines',
      orderDate: new Date(Date.now() - PAST_DAY_MS),
      lines: [
        { barcode: 'UNKNOWN-A', platformLineId: '9001' },
        { barcode: 'UNKNOWN-B', platformLineId: '9002' },
      ],
    });

    await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    // Idempotent re-scan (saatlik cron senaryosu) — satır sayısı sabit kalmalı.
    await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });

    const items = await prisma.orderItem.findMany({
      where: { order: { storeId: store.id, platformOrderId: 'novar-two-lines' } },
      orderBy: { barcode: 'asc' },
    });
    expect(items.map((i) => i.barcode)).toEqual(['UNKNOWN-A', 'UNKNOWN-B']);
    expect(items.every((i) => i.productVariantId === null)).toBe(true);
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
