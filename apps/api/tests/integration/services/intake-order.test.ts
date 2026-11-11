import { prisma } from '@pazarsync/db';
import type { Prisma } from '@pazarsync/db';
import { ProfitRecomputeReason, ProfitStatementView, ProfitStatus } from '@pazarsync/db/enums';
import type { MappedOrder } from '@pazarsync/marketplace';
import { intakeOrder } from '@pazarsync/order-sync';
import { drainProfitRecomputeQueue } from '@pazarsync/profit';
import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
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
  /** Parent order number. Defaults to `ord-${platformOrderId}`; pass explicitly
   * when two orders share a platformOrderId (package-pending collision on '0'). */
  platformOrderNumber?: string;
  orderDate: Date;
  /** Marketplace lastModifiedDate — drives the out-of-order / refresh comparison.
   * Defaults to orderDate when omitted (the pre-existing tests' behavior). */
  lastModifiedDate?: Date;
  barcode?: string;
  status?: MappedOrder['status'];
  dematerialized?: boolean;
  /** Awaiting order whose shipment package Trendyol has not created yet
   * (shipmentPackageId 0). Defaults false. */
  packagePending?: boolean;
  /** Multi-line orders: each entry clones the single-line template below. */
  lines?: Array<{ barcode: string; platformLineId: string }>;
}): MappedOrder {
  // GROSS konvansiyon (2026-06-16): MappedOrderLine gross alanlar.
  // lineSaleGross 100 = net 84.75 + KDV 15.25 (%18). Raw commission rate 15%.
  const lineTemplate = {
    quantity: 1,
    lineListGross: '100',
    lineSaleGross: '100',
    lineSellerDiscountGross: '0',
    saleVatRate: '18',
    commissionRate: '15',
    commissionKnown: true,
  };
  return {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: over.platformOrderNumber ?? `ord-${over.platformOrderId}`,
    orderDate: over.orderDate,
    lastModifiedDate: over.lastModifiedDate ?? over.orderDate,
    status: over.status ?? 'PROCESSING',
    dematerialized: over.dematerialized ?? false,
    packagePending: over.packagePending ?? false,
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
    isExportSale: false,
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

// Seed a variant whose cost was entered IN TIME for `orderDate`: the link is
// attached, and the profile carries a first version effective, one minute before
// the order's business day ends. Used by the past-day cost-window tests that need a
// timely cost (the plain `seedVariant(..., true)` attaches at now(), which is after
// any past day, so it models a cost entered too late).
async function seedVariantWithTimelyCost(
  orgId: string,
  storeId: string,
  barcode: string,
  orderDate: Date,
): Promise<void> {
  await seedVariant(orgId, storeId, barcode, false);
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { storeId, barcode } });
  const inTime = new Date(getBusinessDayRange(orderDate).end.getTime() - 60 * 1000);
  const profile = await createCostProfile(orgId, { storeId, amountGross: '40.00' });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: orgId,
      productVariantId: variant.id,
      profileId: profile.id,
      attachedAt: inTime,
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: orgId,
      version: 1,
      name: profile.name,
      type: profile.type,
      amountGross: profile.amountGross,
      vatRate: profile.vatRate,
      changedFields: [],
      effectiveFrom: inTime,
    },
  });
}

// Attach a cost profile to an already-seeded (cost-missing) variant, flipping it to
// calculable -- mirrors the cost-attach service's link write (the same step the
// buffer-promote end-to-end test uses before promoting).
async function attachCost(orgId: string, storeId: string, barcode: string): Promise<void> {
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { storeId, barcode } });
  const profile = await createCostProfile(orgId, { storeId, amountGross: '40.00' });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: orgId, productVariantId: variant.id, profileId: profile.id },
  });
}

// Set a known starting stock on the single variant behind `barcode` and align the
// denormalized Product.totalStock (seedVariant leaves quantity at its 0 default),
// so the optimistic-decrement assertions have an observable baseline.
async function setStock(storeId: string, barcode: string, quantity: number): Promise<void> {
  await prisma.productVariant.updateMany({ where: { storeId, barcode }, data: { quantity } });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { storeId, barcode } });
  await prisma.product.update({
    where: { id: variant.productId },
    data: { totalStock: quantity },
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

  it('excludes a past-day order that arrives without a timely cost', async () => {
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

    // Cost-window rule (Berkin 2026-11-03): a past-day order whose cost was never
    // entered in time is persisted but permanently excluded with LATE_UNCOSTED_ARRIVAL.
    expect(outcome).toEqual({ kind: 'persisted', reason: 'late_uncosted_arrival' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('late-1');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    // Still enqueued for a profit recompute like every other write.
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
    // Draining resolves the excluded order to an EXCLUDED best-known statement.
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    const stmt = await prisma.orderProfitStatement.findFirst({
      where: { orderId: order.id, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(stmt?.status).toBe(ProfitStatus.EXCLUDED);
  });

  it('excludes a past-day order whose cost was entered only after its day', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // seedVariant(..., true) attaches the cost at now() — after any past day — so the
    // order IS calculable now, but the cost missed the order's day (decision 2).
    await seedVariant(org.id, store.id, BARCODE, true);

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'late-cost-1',
        orderDate: new Date(Date.now() - PAST_DAY_MS),
      }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'late_uncosted_arrival' });
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
  });

  it('does not exclude a past-day order blocked only by a missing desi', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = new Date(Date.now() - PAST_DAY_MS);
    // Timely cost but no desi seeded: only a missing COST excludes, never a missing
    // desi — so the order enters profit (not excluded), even if its shipping estimate
    // later resolves to not-computable.
    await seedVariantWithTimelyCost(org.id, store.id, BARCODE, orderDate);

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'desi-1', orderDate }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'calculable' });
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExcludedAt).toBeNull();
    expect(order.profitExclusionReason).toBeNull();
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

    expect(outcome).toEqual({ kind: 'persisted', reason: 'late_uncosted_arrival' });
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

  it('mixed order past-day: BOTH lines persist; order is excluded as a whole (K5)', async () => {
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

    // One unmatched line makes the order cost_missing — both lines persist, and the
    // past-day order is excluded as a whole (LATE_UNCOSTED_ARRIVAL). The matched line
    // keeps its variant identity.
    expect(outcome).toEqual({ kind: 'persisted', reason: 'late_uncosted_arrival' });
    const items = await prisma.orderItem.findMany({
      where: { order: { storeId: store.id, platformOrderId: 'mixed-1' } },
      orderBy: { barcode: 'asc' },
    });
    expect(items).toHaveLength(2);
    const [matched, unmatched] = items;
    expect(matched!.barcode).toBe('EAN13-MIX-OK');
    expect(matched!.productVariantId).not.toBeNull();
    expect(unmatched!.barcode).toBe('UNKNOWN-MIX');
    expect(unmatched!.productVariantId).toBeNull();
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'mixed-1' },
    });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
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

  it('(d) dematerialize reverses the ghost stock decrement — split children net to a single decrement (no double)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, true); // variant + cost → calculable
    // seedVariant leaves quantity at the 0 default; set a known starting stock
    // and align the denormalized Product.totalStock.
    await prisma.productVariant.updateMany({
      where: { storeId: store.id, barcode: BARCODE },
      data: { quantity: 10 },
    });
    const seeded = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    await prisma.product.update({ where: { id: seeded.productId }, data: { totalStock: 10 } });

    // 1. Pre-split package persists as a real order (calculable, today) → the
    //    optimistic decrement fires: 10 → 9.
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'split-parent', orderDate: new Date() }),
    });
    expect(
      (
        await prisma.productVariant.findFirstOrThrow({
          where: { storeId: store.id, barcode: BARCODE },
        })
      ).quantity,
    ).toBe(9);

    // 2. Trendyol reports the parent UnPacked (split happened) → the ghost order
    //    is deleted AND its decrement reversed: 9 → 10.
    const demat = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'split-parent',
        orderDate: new Date(),
        status: 'CANCELLED',
        dematerialized: true,
      }),
    });
    expect(demat).toEqual({ kind: 'dematerialized', deletedOrder: true, deletedBufferEntries: 0 });
    const afterDemat = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(afterDemat.quantity).toBe(10); // reversal netted the parent decrement out
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: afterDemat.productId } })).totalStock,
    ).toBe(10);

    // 3. The createdBy="split" child re-carries the content under a NEW
    //    shipmentPackageId → decrements exactly once: 10 → 9 (NOT 8, which a
    //    double-decrement — ghost + child — would have produced).
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'split-child', orderDate: new Date() }),
    });
    const afterChild = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(afterChild.quantity).toBe(9);
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: afterChild.productId } })).totalStock,
    ).toBe(9);
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

  // ── Optimistic stock decrement at INTAKE (owner ruling 2026-07-11) ──
  // The sale is real the moment the order arrives, so local stock drops
  // immediately even when the order parks in the cost-missing buffer.

  it('(stock a) cost-missing today buffered intake decrements the matched variant immediately (40 → 39, no orders row)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false); // cost-missing → buffer
    await setStock(store.id, BARCODE, 40);

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'stock-buf', orderDate: new Date() }),
    });

    expect(outcome).toEqual({ kind: 'buffered' });
    // Stock dropped the moment the order arrived, even though it sits in the
    // buffer waiting for cost — 40 → 39, with NO persisted orders row.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(variant.quantity).toBe(39);
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: variant.productId } })).totalStock,
    ).toBe(39);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(1);
  });

  it('(stock c) a buffered_deduped re-delivery does NOT decrement a second time', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);
    await setStock(store.id, BARCODE, 40);
    const mapped = buildMapped({ platformOrderId: 'stock-dedupe', orderDate: new Date() });

    const first = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    const second = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });

    expect(first).toEqual({ kind: 'buffered' });
    expect(second).toEqual({ kind: 'buffered_deduped' });
    // Only the genuinely-new 'buffered' outcome moved stock. The dedupe path hits
    // the buffer unique (P2002), which aborts the tx BEFORE its decrement runs, so
    // stock stays at the single 40 → 39 drop.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(variant.quantity).toBe(39);
  });

  it('(stock d) calculable intake decrements at persist (direct, never buffered)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, true); // variant + cost → calculable
    await setStock(store.id, BARCODE, 40);

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'stock-calc', orderDate: new Date() }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'calculable' });
    // A direct persist (never buffered) still decrements at write time — 40 → 39.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(variant.quantity).toBe(39);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
  });

  it('(stock e) dematerialize of a buffered ghost re-adds the intake decrement (no orders row ever written)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false); // cost-missing → buffer
    await setStock(store.id, BARCODE, 40);

    // Cost-missing today → buffered; the intake decrement drops stock 40 → 39,
    // with NO orders row ever written for this platformOrderId.
    await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'split-buffered-ghost', orderDate: new Date() }),
    });
    expect(
      (
        await prisma.productVariant.findFirstOrThrow({
          where: { storeId: store.id, barcode: BARCODE },
        })
      ).quantity,
    ).toBe(39);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);

    // The split dissolves the pre-split package (UnPacked) → the buffer row is
    // deleted AND its intake decrement reversed from the BUFFER lines: 39 → 40.
    const demat = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: 'split-buffered-ghost',
        orderDate: new Date(),
        status: 'CANCELLED',
        dematerialized: true,
      }),
    });
    expect(demat).toEqual({ kind: 'dematerialized', deletedOrder: false, deletedBufferEntries: 1 });
    const afterDemat = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(afterDemat.quantity).toBe(40); // reversal netted the buffered decrement out
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: afterDemat.productId } })).totalStock,
    ).toBe(40);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
  });

  // --- Buffer graduation on persist (Faz 4A, Gorev 8) ---
  // A cost-missing order parks in the buffer; once its cost is attached it becomes
  // calculable, and the next delivery reaches a persist branch. That persist must
  // graduate (delete) the buffer row atomically, or the order would sit in BOTH
  // `orders` and the buffer and getKpis would double-count it.

  it('persists a buffered order that became calculable and removes its buffer entry', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false); // cost-missing -> buffer
    const mapped = buildMapped({ platformOrderId: 'graduate-1', orderDate: new Date() });

    // 1. Cost-missing today -> buffered (PENDING), no orders row.
    const first = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    expect(first).toEqual({ kind: 'buffered' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);

    // 2. The cost is attached -> the order is now calculable.
    await attachCost(org.id, store.id, BARCODE);

    // 3. The same order re-delivers (a status webhook or the periodic ORDERS sync)
    //    and is now calculable -> it persists AND its buffer row is graduated away in
    //    the same transaction. Before the fix the buffer row lingered until the
    //    promote tick / midnight flush, so the order double-counted on Live Performance.
    const second = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    expect(second).toEqual({ kind: 'persisted', reason: 'calculable' });
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('does not decrement stock twice when a buffered order becomes calculable', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false); // cost-missing -> buffer
    await setStock(store.id, BARCODE, 40);
    const mapped = buildMapped({ platformOrderId: 'graduate-stock', orderDate: new Date() });

    // 1. Buffered intake drops stock once: 40 -> 39.
    await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    expect(
      (
        await prisma.productVariant.findFirstOrThrow({
          where: { storeId: store.id, barcode: BARCODE },
        })
      ).quantity,
    ).toBe(39);

    // 2. Cost attached -> the order becomes calculable.
    await attachCost(org.id, store.id, BARCODE);

    // 3. The re-delivery graduates the buffer row into `orders`. The graduation
    //    carries promotedFromBuffer, so it must NOT decrement a second time -- the
    //    intake already dropped the unit. Stock stays at the single 40 -> 39 drop
    //    (before the fix the calculable branch decremented again -> 38).
    const outcome = await intakeOrder({ storeId: store.id, organizationId: org.id, mapped });
    expect(outcome).toEqual({ kind: 'persisted', reason: 'calculable' });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(variant.quantity).toBe(39);
    expect(
      (await prisma.product.findFirstOrThrow({ where: { id: variant.productId } })).totalStock,
    ).toBe(39);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('graduates a coexisting past-day buffer entry as COST_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false); // cost-missing -> buffer
    await setStock(store.id, BARCODE, 40);
    const platformOrderId = 'graduate-past';

    // 1. Same-day cost-missing intake -> buffered (PENDING); the optimistic intake
    //    decrement drops stock once, 40 -> 39, with no orders row yet.
    const first = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId, orderDate: new Date() }),
    });
    expect(first).toEqual({ kind: 'buffered' });
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(1);
    expect(
      (
        await prisma.productVariant.findFirstOrThrow({
          where: { storeId: store.id, barcode: BARCODE },
        })
      ).quantity,
    ).toBe(39);

    // 2. The order re-delivers once its business day has closed (modeled with a
    //    past-day orderDate) while the buffer row still coexists. It graduates into
    //    orders and the buffer row is deleted in the same transaction. Because a
    //    buffer row was removed, the permanent reason is COST_DEADLINE_MISSED: the
    //    order was here within its day and merely missed the cost deadline (the same
    //    reason the midnight flush would stamp), NOT LATE_UNCOSTED_ARRIVAL. Before the
    //    fix the past-day branch stamped LATE_UNCOSTED_ARRIVAL unconditionally.
    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId, orderDate: new Date(Date.now() - PAST_DAY_MS) }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'late_uncosted_arrival' });
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
    // Graduation carries promotedFromBuffer, so it does NOT decrement a second time:
    // stock stays at the single 40 -> 39 drop from the buffered intake.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(variant.quantity).toBe(39);
  });

  it('heals an order that sits in both tables without restamping or decrementing again', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false); // cost-missing (today -> would buffer)
    await setStock(store.id, BARCODE, 40);
    const today = new Date();

    // A rare cross-path state: the order is ALREADY in `orders` (e.g. costed earlier,
    // its profile later archived) AND a buffer row coexists for the same platformOrderId.
    await prisma.order.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformOrderId: 'heal-1',
        platformOrderNumber: 'ord-heal-1',
        orderDate: today,
        status: 'PROCESSING',
      },
    });
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'heal-1',
      orderDate: getBusinessDateAnchor(today),
      status: 'PENDING',
    });

    // A re-delivery (today, still cost-missing) takes the already_in_orders branch: it
    // persists idempotently and graduates the coexisting buffer row away in the same tx.
    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({ platformOrderId: 'heal-1', orderDate: today }),
    });

    expect(outcome).toEqual({ kind: 'persisted', reason: 'already_in_orders' });
    // Buffer row graduated away; still exactly one orders row.
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    // The heal never stamps an exclusion -- the already_in_orders branch flags no
    // pastDayUncosted, and the update branch never touches the exclusion columns.
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExcludedAt).toBeNull();
    expect(order.profitExclusionReason).toBeNull();
    // A buffer row was removed, so promotedFromBuffer suppresses a second decrement:
    // stock stays at its starting 40, untouched by the heal.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(variant.quantity).toBe(40);
  });
});

// ─── Package-pending skip (Awaiting orders, shipmentPackageId 0) ──────────
// Trendyol reports shipmentPackageId 0 for a package it has not created yet, so
// the mapper gives every Awaiting order the same platformOrderId '0'. Distinct
// order numbers would collide onto a single orders / buffer row (the live-data
// defect that prompted this fix). intakeOrder must skip such a package with no
// DB access at all — no order, no buffer row, no stock movement.
describe('intakeOrder — package-pending skip (Awaiting, no package id yet)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('skips two Awaiting orders (today + yesterday) that collide on platformOrderId 0', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // A matched, calculable variant with a known starting stock: the skip must
    // leave it untouched (no optimistic decrement).
    await seedVariant(org.id, store.id, BARCODE, true);
    await setStock(store.id, BARCODE, 40);

    const today = new Date();
    const yesterday = new Date(Date.now() - PAST_DAY_MS);

    // Both package-pending → platformOrderId '0', different order numbers (the
    // real collision: 19 distinct order numbers all mapped to '0').
    const todayOutcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: '0',
        platformOrderNumber: '2147427535',
        orderDate: today,
        packagePending: true,
      }),
    });
    const pastOutcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: '0',
        platformOrderNumber: '2147427999',
        orderDate: yesterday,
        packagePending: true,
      }),
    });

    expect(todayOutcome).toEqual({ kind: 'skipped', reason: 'package_pending' });
    expect(pastOutcome).toEqual({ kind: 'skipped', reason: 'package_pending' });

    // Nothing was written by either path.
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);

    // The matched variant's stock is unchanged.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(variant.quantity).toBe(40);
  });

  it('leaves a pre-existing buffer row of a DIFFERENT order (real package id) untouched', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVariant(org.id, store.id, BARCODE, false);

    // A genuine today cost-missing order already parked in the buffer under its
    // real package id.
    await createBufferEntry(org.id, store.id, {
      platformOrderId: '700000123',
      platformOrderNumber: 'real-order-123',
      status: 'PENDING',
    });

    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMapped({
        platformOrderId: '0',
        platformOrderNumber: '2147427535',
        orderDate: new Date(),
        packagePending: true,
      }),
    });

    expect(outcome).toEqual({ kind: 'skipped', reason: 'package_pending' });
    // The package-pending skip does no DB work, so the unrelated buffer row survives.
    const rows = await prisma.livePerformanceBuffer.findMany({ where: { storeId: store.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.platformOrderId).toBe('700000123');
  });
});
