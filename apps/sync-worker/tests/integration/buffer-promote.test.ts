import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { BufferEntryStatus, Prisma } from '@pazarsync/db';
import {
  CommissionRuleKind,
  Platform,
  ProfitLineType,
  ProfitRecomputeReason,
  ProfitStatementView,
  ProfitStatus,
} from '@pazarsync/db/enums';
import type { MappedOrder } from '@pazarsync/marketplace';
import { intakeOrder, upsertOrderWithSnapshot } from '@pazarsync/order-sync';
import { drainProfitRecomputeQueue, resetSettledCutoffMemo } from '@pazarsync/profit';
import {
  getBusinessDateAnchor,
  getBusinessDayRange,
  SELLER_INPUT_SETTLE_MS,
} from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { processBufferPromote, processPastDayBufferFlush } from '../../src/handlers/buffer-promote';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createOrganization,
  createStore,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';
import { clearSellerInputHistory } from '../../../../apps/api/tests/helpers/seller-input-history';

const BARCODE = 'EAN13-PROMOTE-001';

/**
 * A MappedOrder-shaped value as stored in buffer.mappedOrder (JSON). Dates are
 * ISO strings (JSON round-trip — upsertOrderWithSnapshot coerces them). With
 * `invalid: true` a line carries a non-numeric lineSaleGross so the upsert's
 * `new Decimal(...)` throws — a deterministic promote failure for the retry path.
 */
function buildMappedOrder(over: {
  platformOrderId: string;
  platformOrderNumber?: string;
  barcode?: string;
  invalid?: boolean;
  fastDeliveryType?: string;
  estimatedDeliveryStartDate?: string;
  estimatedDeliveryEndDate?: string;
  actualShipDate?: string;
  /** ISO string — the marketplace lastModifiedDate carried by the buffer snapshot.
   * Omitted by default so existing rows keep their lastModifiedDate-free shape. */
  lastModifiedDate?: string;
  /** Order status in the snapshot. Defaults to PROCESSING; CANCELLED exercises the
   * cost-window skip (a cancelled order is never excluded at graduation). */
  status?: string;
  /** ISO string: the order instant in the snapshot. Defaults to now; a past-day case
   * that asserts the graduated order's captured inputs passes its entry's day. */
  orderDate?: string;
}): Prisma.InputJsonValue {
  const exportFlag = { isExportSale: false };
  const value = {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: over.platformOrderNumber ?? `ord-${over.platformOrderId}`,
    orderDate: over.orderDate ?? new Date().toISOString(),
    ...(over.lastModifiedDate !== undefined && { lastModifiedDate: over.lastModifiedDate }),
    status: over.status ?? 'PROCESSING',
    // GROSS konvansiyon: saleGross (KDV-dahil) = 100; saleVat = 100×18/118 = 15.25.
    saleGross: '100.00',
    saleVat: '15.25',
    listGross: '100.00',
    sellerDiscountGross: '0.00',
    promotionDisplays: null,
    agreedDeliveryDate: null,
    actualDeliveryDate: null,
    actualShipDate: over.actualShipDate ?? null,
    fastDelivery: false,
    fastDeliveryType: over.fastDeliveryType ?? null,
    ...exportFlag,
    estimatedDeliveryStartDate: over.estimatedDeliveryStartDate ?? null,
    estimatedDeliveryEndDate: over.estimatedDeliveryEndDate ?? null,
    lines: [
      {
        barcode: over.barcode ?? BARCODE,
        quantity: 1,
        // invalid → non-numeric lineSaleGross → upsert new Decimal() throws.
        lineListGross: '100.00',
        lineSaleGross: over.invalid === true ? 'NOT_A_NUMBER' : '100.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '18',
        commissionRate: '15',
      },
    ],
  };
  return value as unknown as Prisma.InputJsonValue;
}

// A real MappedOrder (Date objects, not the JSON round-trip shape) for driving
// `intakeOrder` directly — the end-to-end intake→promote decrement test needs the
// in-memory DTO the way the webhook / sync worker hands it to intake.
function buildMappedForIntake(over: {
  platformOrderId: string;
  barcode: string;
  quantity: number;
  orderDate: Date;
  /** False models the sparse payload with no commission on the line (rate is the
   *  mapper's defensive '0'). Defaults to true (a 15% line rate). */
  commissionKnown?: boolean;
}): MappedOrder {
  const commissionKnown = over.commissionKnown ?? true;
  return {
    platformOrderId: over.platformOrderId,
    platformOrderNumber: `ord-${over.platformOrderId}`,
    orderDate: over.orderDate,
    lastModifiedDate: over.orderDate,
    status: 'PROCESSING',
    dematerialized: false,
    packagePending: false,
    saleGross: '100.00',
    saleVat: '15.25',
    listGross: '100.00',
    sellerDiscountGross: '0.00',
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
    lines: [
      {
        barcode: over.barcode,
        quantity: over.quantity,
        platformLineId: null,
        lineListGross: '100.00',
        lineSaleGross: '100.00',
        lineSellerDiscountGross: '0.00',
        saleVatRate: '18',
        commissionRate: commissionKnown ? '15' : '0',
        commissionKnown,
      },
    ],
  };
}

async function seedCalculableVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
): Promise<void> {
  const profile = await createCostProfile(organizationId, { amountGross: '48.00' });
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Promote Test Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      costProfileLinks: { create: { organizationId, profileId: profile.id } },
    },
  });
}

// Seed a variant whose cost was entered IN TIME for `orderDate`: the link is
// attached, and the profile's first version becomes effective, one minute before
// the order's business day ends. Models a cost attached just before midnight whose
// buffer-flip had not fired yet when the day-end flush runs after midnight.
async function seedTimelyCostedVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
  orderDate: Date,
): Promise<void> {
  const profile = await createCostProfile(organizationId, {
    storeId,
    amountGross: '48.00',
    seedVersion: false,
  });
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Promote Test Product',
    },
  });
  const inTime = new Date(getBusinessDayRange(orderDate).end.getTime() - 60 * 1000);
  await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      costProfileLinks: { create: { organizationId, profileId: profile.id, attachedAt: inTime } },
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId,
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

// Seed a variant whose cost was entered AFTER `orderDate`'s business day ended:
// the link is attached, and the profile's first version becomes effective, one
// minute after the day end. buildCalcCheckLines judges the link at that day end, so
// it sees no cost, and the cost missed the window: a past-day graduation must be
// excluded with COST_DEADLINE_MISSED.
async function seedLateCostedVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
  orderDate: Date,
): Promise<void> {
  const profile = await createCostProfile(organizationId, {
    storeId,
    amountGross: '48.00',
    seedVersion: false,
  });
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Promote Test Product',
    },
  });
  const tooLate = new Date(getBusinessDayRange(orderDate).end.getTime() + 60 * 1000);
  await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      costProfileLinks: { create: { organizationId, profileId: profile.id, attachedAt: tooLate } },
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId,
      version: 1,
      name: profile.name,
      type: profile.type,
      amountGross: profile.amountGross,
      vatRate: profile.vatRate,
      changedFields: [],
      effectiveFrom: tooLate,
    },
  });
}

// Leave the variant behind `barcode` with no desi at all (no Trendyol desi, no seller
// desi). The column default is 0, a REAL desi (plan PR-2c decision 1), so a desiless
// fixture writes null explicitly.
async function clearVariantDesi(storeId: string, barcode: string): Promise<void> {
  await prisma.productVariant.updateMany({
    where: { storeId, barcode },
    data: { syncedDimensionalWeight: null, dimensionalWeightOverride: null },
  });
}

// Seed a resolvable variant with NO cost and NO desi (both gates open).
async function seedUncostedDesilessVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
): Promise<void> {
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Promote Test Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      syncedDimensionalWeight: null,
    },
  });
}

// The commission category of the path-parity test and its Trendyol category rule.
const PARITY_CATEGORY_ID = 626n;
const PARITY_CATEGORY_RATE = '19';

// Seed a variant whose product sits in PARITY_CATEGORY_ID, with a 1-desi weight for the
// shipping estimate and no synced commission rate (so only the category rule can price
// the commission). withCost attaches a 48.00 cost profile; without it intake buffers.
async function seedCategoryVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
  withCost: boolean,
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Promote Parity Product',
      categoryId: PARITY_CATEGORY_ID,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '100',
      syncedDimensionalWeight: '1',
    },
  });
  if (withCost) {
    await attachVersionedCost(organizationId, storeId, variant.id);
  }
  return variant.id;
}

// Attach a 48.00 cost profile with a version effective long before the order (the
// factory's version 1), so the loader reads a cost for the order's day.
async function attachVersionedCost(
  organizationId: string,
  storeId: string,
  variantId: string,
): Promise<void> {
  const profile = await createCostProfile(organizationId, { storeId, amountGross: '48.00' });
  await prisma.productVariantCostProfile.create({
    data: { organizationId, productVariantId: variantId, profileId: profile.id },
  });
}

// Far-past instant for a cost that has been in place long before any test order.
const LONG_AGO = new Date('2000-01-01T00:00:00Z');

// Seed a variant (with its default desi) linked to one 48.00 profile whose version 1
// dates from LONG_AGO. `attachedAt` stamps the link (default LONG_AGO). With
// `archivedAt` the profile is archived the way the cost-profile service does it: the
// profile row is stamped and an archive version 2 (archivedAt = effectiveFrom = the
// archive instant) is appended.
async function seedVersionedCostVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
  options: { archivedAt?: Date; attachedAt?: Date } = {},
): Promise<void> {
  const profile = await createCostProfile(organizationId, {
    storeId,
    amountGross: '48.00',
    seedVersion: false,
  });
  const versionBase = {
    profileId: profile.id,
    organizationId,
    name: profile.name,
    type: profile.type,
    amountGross: profile.amountGross,
    vatRate: profile.vatRate,
  };
  await prisma.costProfileVersion.create({
    data: { ...versionBase, version: 1, changedFields: [], effectiveFrom: LONG_AGO },
  });
  if (options.archivedAt !== undefined) {
    await prisma.costProfileVersion.create({
      data: {
        ...versionBase,
        version: 2,
        archivedAt: options.archivedAt,
        changedFields: ['archivedAt'],
        effectiveFrom: options.archivedAt,
      },
    });
    await prisma.costProfile.update({
      where: { id: profile.id },
      data: { archivedAt: options.archivedAt },
    });
  }
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Promote Test Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode,
      stockCode: `sk-${barcode}`,
      salePrice: '100',
      listPrice: '120',
      costProfileLinks: {
        create: {
          organizationId,
          profileId: profile.id,
          attachedAt: options.attachedAt ?? LONG_AGO,
        },
      },
    },
  });
}

describe('processBufferPromote', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    resetSettledCutoffMemo();
  });

  it('promotes a PROMOTING entry to orders and deletes the buffer row', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);

    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-001',
      platformOrderNumber: 'ord-001',
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-001',
        platformOrderNumber: 'ord-001',
        fastDeliveryType: 'FastDelivery',
        estimatedDeliveryStartDate: '2026-06-12T15:57:28.000Z',
        estimatedDeliveryEndDate: '2026-06-13T11:38:56.000Z',
        actualShipDate: '2026-06-12T11:35:54.000Z',
      }),
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('pkg-001');
    // Phase 3B: promotion persists + enqueues a recompute (no inline estimate).
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
    // Buffer graduation stamps promotedFromBufferAt so the realtime toast can
    // suppress a duplicate ding for an order the seller already saw buffered.
    expect(order.promotedFromBufferAt).not.toBeNull();
    // Buffer JSONB round-trip: ISO-string tarihler new Date() ile coerce edilir,
    // fastDeliveryType ?? null ile geçer (2026-06-14 capture — review gap kapatma).
    expect(order.fastDeliveryType).toBe('FastDelivery');
    expect(order.estimatedDeliveryStartDate?.toISOString()).toBe('2026-06-12T15:57:28.000Z');
    expect(order.estimatedDeliveryEndDate?.toISOString()).toBe('2026-06-13T11:38:56.000Z');
    expect(order.actualShipDate?.toISOString()).toBe('2026-06-12T11:35:54.000Z');
  });

  it('promotes a today entry without throwing on the JSONB string orderDate, and does NOT decrement at promote (intake-time semantics)', async () => {
    // Regression for the optimistic-decrement business-today gate: the buffer's
    // mapped_order is JSONB, so `orderDate` revives as an ISO STRING. The gate
    // must normalize that string (not throw `Invalid time value`). Under the
    // intake-time-decrement ruling (2026-07-11) the promote itself moves NO stock:
    // the decrement fires when an order first enters the buffer, and the
    // graduation is flagged promotedFromBuffer so it never subtracts again. This
    // row was seeded directly (bypassing intake), so no decrement ever fired —
    // the stock must be unchanged after promote (previously this asserted 5 → 4).
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);
    // Give the variant a known starting stock so a stray promote-time decrement
    // would be observable (seedCalculableVariant leaves quantity at its 0 default).
    await prisma.productVariant.updateMany({
      where: { storeId: store.id, barcode: BARCODE },
      data: { quantity: 5 },
    });

    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-stock',
      platformOrderNumber: 'ord-stock',
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-stock',
        platformOrderNumber: 'ord-stock',
      }),
    });

    await processBufferPromote();

    // Promote succeeded — the string orderDate no longer throws at the gate.
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('pkg-stock');
    // The graduation carries promotedFromBuffer → no promote-time decrement. This
    // row never went through intake, so stock stays at its seeded 5.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { storeId: store.id, barcode: BARCODE },
    });
    expect(variant.quantity).toBe(5);
  });

  it('(b) intake decrements at buffer time; a later promote does NOT decrement again (end-to-end 40 → 39, stays 39)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Variant WITHOUT a cost profile so intake routes to the buffer (cost-missing
    // today), seeded with a known starting stock.
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
        productMainId: `pm-${BARCODE}`,
        title: 'E2E Stock Product',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
        barcode: BARCODE,
        stockCode: `sk-${BARCODE}`,
        salePrice: '100',
        listPrice: '120',
        quantity: 40,
      },
    });
    await prisma.product.update({ where: { id: product.id }, data: { totalStock: 40 } });

    // A real instant inside today's business day (noon UTC → 15:00 Istanbul) so
    // the intake business-today gate fires deterministically.
    const todayInstant = new Date(getBusinessDateAnchor().getTime() + 12 * 60 * 60 * 1000);

    // 1. Intake the cost-missing order → buffered; stock drops immediately 40 → 39.
    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: buildMappedForIntake({
        platformOrderId: 'e2e-stock',
        barcode: BARCODE,
        quantity: 1,
        orderDate: todayInstant,
      }),
    });
    expect(outcome).toEqual({ kind: 'buffered' });
    expect(
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).quantity,
    ).toBe(39);

    // 2. Cost arrives: attach a profile + flip the buffer row to PROMOTING (what
    //    the cost-attach service does when a same-day cost lands).
    const profile = await createCostProfile(org.id, { amountGross: '48.00' });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, productVariantId: variant.id, profileId: profile.id },
    });
    await prisma.livePerformanceBuffer.updateMany({
      where: { storeId: store.id, platformOrderId: 'e2e-stock' },
      data: { status: 'PROMOTING' },
    });

    // 3. Promote graduates the order → buffer row consumed, but the graduation
    //    carries promotedFromBuffer, so it must NOT decrement a second time.
    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('e2e-stock');
    expect(order.promotedFromBufferAt).not.toBeNull();
    // Stock stayed at the single intake-time decrement — promote added no second.
    expect(
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).quantity,
    ).toBe(39);
  });

  it('does not pick up a FAILED entry before its backoff window elapses', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);

    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-backoff',
      status: 'FAILED',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-backoff' }),
    });
    // attempts=1 needs a 5-min wait; failed 2 min ago → not yet due.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 1, lastFailedAt: new Date(Date.now() - 2 * 60_000), lastError: 'x' },
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(1);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('marks FAILED + increments attempts when the promote throws', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Calculable variant: the calc gate passes, then the invalid lineSaleGross
    // makes the upsert throw — pins the tx-failure retry machinery.
    await seedCalculableVariant(org.id, store.id, BARCODE);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-fail',
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-fail', invalid: true }),
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBeTruthy();
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('marks PERMANENT_FAILED when the final (4th) attempt still fails', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-perm',
      status: 'FAILED',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-perm', invalid: true }),
    });
    // attempts=3, failed 60 min ago (> 45) → due for its final retry; it fails.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 3, lastFailedAt: new Date(Date.now() - 60 * 60_000), lastError: 'x' },
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.attempts).toBe(4);
    expect(after.status).toBe('PERMANENT_FAILED');
  });

  it('flush-failed handoff: past-day FAILED entry with missing cost graduates COST_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // No cost seeded — the entry is NOT calculable. A flush failure handed it to the
    // promote retry path; cost-window rule (Berkin 2026-11-03): the retry graduates it
    // PROFIT-EXCLUDED (COST_DEADLINE_MISSED), the write still enqueues a recompute.
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-flush-handoff',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 2 * 24 * 60 * 60_000)),
      status: 'FAILED',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-flush-handoff' }),
    });
    // attempts=1, failed 10 min ago (> 5) → due for retry.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 1, lastFailedAt: new Date(Date.now() - 10 * 60_000), lastError: 'x' },
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
    // The graduation is still a buffer -> orders write: it must carry the promotion
    // marker so the toast suppresses this midnight-path INSERT (C2).
    expect(order.promotedFromBufferAt).not.toBeNull();
  });

  it('cost vanished on a today PROMOTING entry → demoted back to PENDING (window still open)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // PROMOTING but no cost in the catalog (e.g. profile archived after the
    // flip): today's window is still open → entry returns to PENDING, no
    // orders row is written.
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-demote',
      orderDate: getBusinessDateAnchor(),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'pkg-demote' }),
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('PENDING');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('desi removed from a costed today PROMOTING entry → demoted back to PENDING (window still open)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // The cost is in place, but the product's desi was emptied after the flip: the
    // desi gate re-checks under the lock, so the same-day entry returns to PENDING.
    await seedCalculableVariant(org.id, store.id, 'EAN13-PROMOTE-NODESI');
    await clearVariantDesi(store.id, 'EAN13-PROMOTE-NODESI');
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-demote-desi',
      orderDate: getBusinessDateAnchor(),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-demote-desi',
        barcode: 'EAN13-PROMOTE-NODESI',
      }),
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('PENDING');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('a same-day PROMOTING entry whose only profile was archived is demoted to PENDING', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedVersionedCostVariant(org.id, store.id, 'EAN13-PROMOTE-ARCHIVED', {
      archivedAt: new Date(Date.now() - 60 * 60_000),
    });
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-demote-archived',
      orderDate: getBusinessDateAnchor(),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-demote-archived',
        barcode: 'EAN13-PROMOTE-ARCHIVED',
      }),
    });

    await processBufferPromote();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('PENDING');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('a same-day PROMOTING entry whose link was attached after the tick started is still promoted', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // The link is stamped a few seconds after the tick's own clock reading (a flip
    // committing while the tick runs, or a clock skew between hosts). The decision
    // time is the order's business-day end, never the tick's clock, so the link
    // counts. Capped at today's day end so a run just before midnight stays valid.
    const attachedAt = new Date(
      Math.min(Date.now() + 5_000, getBusinessDayRange(new Date()).end.getTime()),
    );
    await seedVersionedCostVariant(org.id, store.id, 'EAN13-PROMOTE-FRESH-LINK', { attachedAt });
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-fresh-link',
      orderDate: getBusinessDateAnchor(),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-fresh-link',
        barcode: 'EAN13-PROMOTE-FRESH-LINK',
      }),
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('pkg-fresh-link');
  });

  it('graduates a past-day PROMOTING entry with a timely cost but no desi as DESI_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * 24 * 60 * 60_000));
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-PROMOTE-PAST-NODESI', orderDate);
    await clearVariantDesi(store.id, 'EAN13-PROMOTE-PAST-NODESI');
    // Fixture setup, not history: the variant had no desi on the order's day.
    await clearSellerInputHistory(org.id);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-past-desiless',
      orderDate,
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-past-desiless',
        barcode: 'EAN13-PROMOTE-PAST-NODESI',
      }),
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('DESI_DEADLINE_MISSED');
  });

  it('promote applies the out-of-order guard: stale buffer snapshot deletes the row but never regresses a newer order', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, BARCODE);

    // T1 < T2 — the buffered snapshot is OLDER than the order row's watermark.
    const T1 = new Date('2026-06-12T10:00:00.000Z');
    const T2 = new Date('2026-06-12T12:00:00.000Z');

    // A newer event already wrote the order (status SHIPPED, watermark T2). This
    // is the racing-delivery case: the same order was buffered earlier at T1 and
    // its cost only just arrived, flipping the buffer row to PROMOTING.
    await prisma.order.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformOrderId: 'pkg-guard',
        platformOrderNumber: 'ord-guard',
        orderDate: new Date('2026-06-12T09:00:00.000Z'),
        status: 'SHIPPED',
        platformLastModifiedAt: T2,
      },
    });

    // Matching PROMOTING buffer row whose snapshot carries the OLDER lmd (T1) and
    // a regressive status (PROCESSING via buildMappedOrder's default).
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-guard',
      platformOrderNumber: 'ord-guard',
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-guard',
        platformOrderNumber: 'ord-guard',
        lastModifiedDate: T1.toISOString(),
      }),
    });

    await processBufferPromote();

    // Buffer row consumed (no lingering placeholder → no double-count) …
    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    // … but the order write was skipped by the guard: still exactly one row,
    // status + watermark unchanged at the newer T2 event (no regression).
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.status).toBe('SHIPPED');
    expect(order.platformLastModifiedAt?.toISOString()).toBe(T2.toISOString());
  });

  it('graduates a past-day PROMOTING entry whose cost arrived after its day as COST_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * 24 * 60 * 60_000));
    // The cost was attached (and its version made effective) one minute AFTER the
    // order's day ended, so the entry is calculable now but its cost missed the
    // window. The calculable graduation branch must still exclude it (the BLOCKER:
    // the old branch skipped the cost-window check and graduated it as a normal order).
    await seedLateCostedVariant(org.id, store.id, 'EAN13-PROMOTE-LATE', orderDate);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-late-promoting',
      orderDate,
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-late-promoting',
        barcode: 'EAN13-PROMOTE-LATE',
      }),
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('pkg-late-promoting');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
    expect(order.promotedFromBufferAt).not.toBeNull();
  });

  it('graduates a past-day FAILED entry whose cost arrived after its day as COST_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * 24 * 60 * 60_000));
    // Same late-cost shape, but the entry reaches the promote tick via FAILED (a
    // day-end flush that threw handed it off). The retry graduates it; the late cost
    // must not rescue it from COST_DEADLINE_MISSED.
    await seedLateCostedVariant(org.id, store.id, 'EAN13-PROMOTE-LATE-F', orderDate);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-late-failed',
      orderDate,
      status: 'FAILED',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-late-failed',
        barcode: 'EAN13-PROMOTE-LATE-F',
      }),
    });
    // attempts=1, failed 10 min ago (> 5) -> due for retry.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 1, lastFailedAt: new Date(Date.now() - 10 * 60_000), lastError: 'x' },
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('pkg-late-failed');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  it('graduates a past-day entry whose cost was attached before its day ended as a normal order', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * 24 * 60 * 60_000));
    // Cost attached (and effective) one minute before the order's day ended, but the
    // attach-flip never fired, so the row is still PROMOTING when the promote tick runs
    // after midnight. A timely cost still counts -- it graduates unexcluded.
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-PROMOTE-OK', orderDate);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-timely-promoting',
      orderDate,
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-timely-promoting',
        barcode: 'EAN13-PROMOTE-OK',
      }),
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('pkg-timely-promoting');
    expect(order.profitExcludedAt).toBeNull();
    expect(order.profitExclusionReason).toBeNull();
  });

  it('does not exclude a same-day PROMOTING entry', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Cost attached today, still inside the order's business day. A same-day
    // calculable promote is never excluded -- its cost-flip window is still open.
    await seedCalculableVariant(org.id, store.id, 'EAN13-PROMOTE-TODAY');
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'pkg-today-promoting',
      orderDate: getBusinessDateAnchor(),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'pkg-today-promoting',
        barcode: 'EAN13-PROMOTE-TODAY',
      }),
    });

    await processBufferPromote();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('pkg-today-promoting');
    expect(order.profitExcludedAt).toBeNull();
    expect(order.profitExclusionReason).toBeNull();
  });

  it('direct write and buffer promote reach the same best-known net profit and COMMISSION lines for a line without commission', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id, { platform: Platform.TRENDYOL });
    // The line carries no commission (commissionKnown false) and the variant has no synced
    // rate, so on both paths the engine prices the commission from the category rule.
    await prisma.marketplaceCommissionRate.create({
      data: {
        platform: Platform.TRENDYOL,
        ruleKind: CommissionRuleKind.CATEGORY,
        categoryId: PARITY_CATEGORY_ID,
        brandId: null,
        categoryName: 'Parity Category',
        parentCategoryName: null,
        brandName: null,
        baseRate: new Decimal(PARITY_CATEGORY_RATE),
        paymentTermDays: 60,
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });
    const carrier = await prisma.shippingCarrier.findFirstOrThrow({
      where: { platform: Platform.TRENDYOL, code: 'SENDEOMP' },
    });
    await prisma.store.update({
      where: { id: store.id },
      data: { defaultShippingCarrierId: carrier.id },
    });
    const orderDate = new Date();

    // Path A -- direct: the variant already has a cost, so the order is written at once.
    const barcodeA = 'EAN13-PARITY-A';
    await seedCategoryVariant(org.id, store.id, barcodeA, true);
    // Both orders name the seeded SENDEOMP carrier: an order never uses the store default,
    // and an unrecognized carrier blocks the profit (engine v12).
    const cargoProviderName = 'Kolay Gelsin Marketplace';
    await upsertOrderWithSnapshot(store.id, org.id, {
      ...buildMappedForIntake({
        platformOrderId: 'parity-direct',
        barcode: barcodeA,
        quantity: 1,
        orderDate,
        commissionKnown: false,
      }),
      cargoProviderName,
    });

    // Path B -- buffer: the variant is cost-missing today, so intake buffers it; the cost
    // then arrives and the entry is flipped PROMOTING (cost-attach simulation) -> promote.
    const barcodeB = 'EAN13-PARITY-B';
    const variantB = await seedCategoryVariant(org.id, store.id, barcodeB, false);
    const outcome = await intakeOrder({
      storeId: store.id,
      organizationId: org.id,
      mapped: {
        ...buildMappedForIntake({
          platformOrderId: 'parity-buffer',
          barcode: barcodeB,
          quantity: 1,
          orderDate,
          commissionKnown: false,
        }),
        cargoProviderName,
      },
    });
    expect(outcome).toEqual({ kind: 'buffered' });
    await attachVersionedCost(org.id, store.id, variantB);
    await prisma.livePerformanceBuffer.updateMany({
      where: { storeId: store.id, platformOrderId: 'parity-buffer' },
      data: { status: 'PROMOTING' },
    });
    await processBufferPromote();

    const orderA = await prisma.order.findFirstOrThrow({
      where: { organizationId: org.id, storeId: store.id, platformOrderId: 'parity-direct' },
    });
    const orderB = await prisma.order.findFirstOrThrow({
      where: { organizationId: org.id, storeId: store.id, platformOrderId: 'parity-buffer' },
    });
    // Neither path stores a raw order rate for a line that carried none.
    for (const orderId of [orderA.id, orderB.id]) {
      const item = await prisma.orderItem.findFirstOrThrow({
        where: { organizationId: org.id, orderId },
      });
      expect(item.orderCommissionRatePct).toBeNull();
    }

    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });

    const stmtA = await prisma.orderProfitStatement.findFirstOrThrow({
      where: {
        organizationId: org.id,
        storeId: store.id,
        orderId: orderA.id,
        view: ProfitStatementView.BEST_KNOWN,
      },
    });
    const stmtB = await prisma.orderProfitStatement.findFirstOrThrow({
      where: {
        organizationId: org.id,
        storeId: store.id,
        orderId: orderB.id,
        view: ProfitStatementView.BEST_KNOWN,
      },
    });
    expect(stmtA.status).toBe(ProfitStatus.ESTIMATED);
    expect(stmtB.status).toBe(stmtA.status);
    expect(stmtA.netProfit).not.toBeNull();
    expect(stmtB.netProfit?.toString()).toBe(stmtA.netProfit?.toString());

    // ...and the same COMMISSION lines, priced at the category rate.
    const commissionLines = async (
      orderId: string,
    ): Promise<{ source: string; amountGross: string }[]> => {
      const lines = await prisma.profitLine.findMany({
        where: {
          organizationId: org.id,
          storeId: store.id,
          orderId,
          type: ProfitLineType.COMMISSION,
        },
        orderBy: [{ source: 'asc' }, { amountGross: 'asc' }],
      });
      return lines.map((line) => ({
        source: line.source,
        amountGross: line.amountGross.toString(),
      }));
    };
    const linesA = await commissionLines(orderA.id);
    expect(linesA.length).toBeGreaterThan(0);
    expect(await commissionLines(orderB.id)).toEqual(linesA);
    const commissionTotal = linesA.reduce(
      (acc, line) => acc.add(new Decimal(line.amountGross)),
      new Decimal(0),
    );
    // Sale 100.00 incl. VAT x the 19% category rule.
    expect(commissionTotal.toString()).toBe('19');
  });
});

describe('processPastDayBufferFlush', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    resetSettledCutoffMemo();
  });

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  it('graduates a buffer entry still missing its cost as COST_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // No cost seeded → cost window missed. Cost-window rule (Berkin 2026-11-03): the
    // flush graduates it PROFIT-EXCLUDED (COST_DEADLINE_MISSED); the queued recompute
    // resolves it to an EXCLUDED best-known statement.
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-pending',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS)),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-pending', barcode: 'EAN13-FLUSH' }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-pending');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
    // The graduation enqueued a recompute; draining it resolves the excluded order to
    // an EXCLUDED best-known statement (buffer path end-to-end).
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
    await drainProfitRecomputeQueue(prisma, { batchSize: 10 });
    const stmt = await prisma.orderProfitStatement.findFirst({
      where: { orderId: order.id, view: ProfitStatementView.BEST_KNOWN },
    });
    expect(stmt?.status).toBe(ProfitStatus.EXCLUDED);
    // The midnight flush is exactly the buffer -> orders path whose toast C2 must
    // suppress: the graduated order carries the promotion marker.
    expect(order.promotedFromBufferAt).not.toBeNull();
  });

  it('graduates a buffer entry costed during the day as a normal order', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    // The cost was attached (and its version made effective) one minute before the
    // order's day ended, but the attach-flip never fired, so the row is still PENDING
    // when the flush runs after midnight. A cost attached in time still counts.
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-FLUSH-OK', orderDate);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-costed',
      orderDate,
      status: 'PENDING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-costed', barcode: 'EAN13-FLUSH-OK' }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-costed');
    expect(order.profitExcludedAt).toBeNull();
    expect(order.profitExclusionReason).toBeNull();
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
  });

  it('graduates a costed but desiless buffer entry as DESI_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    // The cost came in time, but the product desi was never entered before the
    // order's day ended (plan PR-2c): the day-end flush stamps the desi reason.
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-FLUSH-NODESI', orderDate);
    await clearVariantDesi(store.id, 'EAN13-FLUSH-NODESI');
    // Fixture setup, not history: the variant had no desi on the order's day.
    await clearSellerInputHistory(org.id);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-desiless',
      orderDate,
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-desiless',
        barcode: 'EAN13-FLUSH-NODESI',
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-desiless');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('DESI_DEADLINE_MISSED');
    expect(order.promotedFromBufferAt).not.toBeNull();
  });

  // The day-close desi switch (plan PR-1) governs only the day-close pass: buffer
  // graduation keeps stamping a desi that is missing at the order's day end.
  it('buffer graduation still stamps DESI_DEADLINE_MISSED for a desi missing at T', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-FLUSH-GUARD-NODESI', orderDate);
    await clearVariantDesi(store.id, 'EAN13-FLUSH-GUARD-NODESI');
    // Positive control: a twin variant with a desi.
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-FLUSH-GUARD-DESI', orderDate);
    await prisma.productVariant.updateMany({
      where: { storeId: store.id, barcode: 'EAN13-FLUSH-GUARD-DESI' },
      data: { syncedDimensionalWeight: '1' },
    });
    // The writes above were fixture setup: each variant had that desi all day.
    await clearSellerInputHistory(org.id);
    for (const { platformOrderId, barcode } of [
      { platformOrderId: 'flush-guard-desiless', barcode: 'EAN13-FLUSH-GUARD-NODESI' },
      { platformOrderId: 'flush-guard-desi', barcode: 'EAN13-FLUSH-GUARD-DESI' },
    ]) {
      await createBufferEntry(org.id, store.id, {
        platformOrderId,
        orderDate,
        status: 'PENDING',
        mappedOrder: buildMappedOrder({
          platformOrderId,
          barcode,
          orderDate: orderDate.toISOString(),
        }),
      });
    }

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const desiless = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'flush-guard-desiless' },
    });
    expect(desiless.profitExclusionReason).toBe('DESI_DEADLINE_MISSED');
    const withDesi = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id, platformOrderId: 'flush-guard-desi' },
    });
    expect(withDesi.profitExcludedAt).toBeNull();
    expect(withDesi.profitExclusionReason).toBeNull();
  });

  // Same-day edit window (plan PR-1, P1-08): graduation judges the seller inputs in
  // force at the order's day end, rebuilt from the history logs; a write stamped
  // after that day end does not reach the order. Dated two days back so the
  // day-close settle point can never interfere.
  it('an entry whose cost was detached after its day graduates as a normal order', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-FLUSH-DETACHED', orderDate);
    const versionIds = (
      await prisma.costProfileVersion.findMany({
        where: { organizationId: org.id },
        select: { id: true },
      })
    ).map((version) => version.id);
    // Detached now, after the order's day end.
    await prisma.productVariantCostProfile.deleteMany({ where: { organizationId: org.id } });
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-detached',
      orderDate,
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-detached',
        barcode: 'EAN13-FLUSH-DETACHED',
        orderDate: orderDate.toISOString(),
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id },
      include: { items: true },
    });
    expect(order.profitExcludedAt).toBeNull();
    expect(order.profitExclusionReason).toBeNull();
    // The graduated item is captured with the cost in force at the day end.
    expect(order.items.map((item) => item.snapshotCostProfileVersionIds)).toEqual([versionIds]);
  });

  it('an entry whose desi was cleared after its day graduates as a normal order', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-FLUSH-DESI-CLEARED', orderDate);
    await prisma.productVariant.updateMany({
      where: { storeId: store.id, barcode: 'EAN13-FLUSH-DESI-CLEARED' },
      data: { syncedDimensionalWeight: '2' },
    });
    // Fixture setup: the variant had that synced desi all day.
    await clearSellerInputHistory(org.id);
    // Cleared now, after the order's day end.
    await clearVariantDesi(store.id, 'EAN13-FLUSH-DESI-CLEARED');
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-desi-cleared',
      orderDate,
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-desi-cleared',
        barcode: 'EAN13-FLUSH-DESI-CLEARED',
        orderDate: orderDate.toISOString(),
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({
      where: { storeId: store.id },
      include: { items: true },
    });
    expect(order.profitExcludedAt).toBeNull();
    expect(order.profitExclusionReason).toBeNull();
    // The graduated item is captured with the desi in force at the day end.
    expect(order.items.map((item) => item.snapshotUnitDesi?.toString())).toEqual(['2']);
    expect(order.items.map((item) => item.snapshotDesiSource)).toEqual(['SYNCED']);
  });

  it('an entry whose desi was first entered after its day graduates DESI_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-FLUSH-DESI-LATE', orderDate);
    await clearVariantDesi(store.id, 'EAN13-FLUSH-DESI-LATE');
    // Fixture setup: the variant never had a desi during the order's day.
    await clearSellerInputHistory(org.id);
    // The seller enters a desi now, after the order's day end.
    await prisma.productVariant.updateMany({
      where: { storeId: store.id, barcode: 'EAN13-FLUSH-DESI-LATE' },
      data: { dimensionalWeightOverride: '3' },
    });
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-desi-late',
      orderDate,
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-desi-late',
        barcode: 'EAN13-FLUSH-DESI-LATE',
        orderDate: orderDate.toISOString(),
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('DESI_DEADLINE_MISSED');
  });

  it('graduates an uncosted and desiless buffer entry as COST_DEADLINE_MISSED (cost wins)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedUncostedDesilessVariant(org.id, store.id, 'EAN13-FLUSH-NOTHING');
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-nothing',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS)),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-nothing',
        barcode: 'EAN13-FLUSH-NOTHING',
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  it('excludes a past-day entry whose cost arrived after its day at the day-end flush', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    // The cost was attached (and its version made effective) one minute AFTER the
    // order's day ended, so the entry is calculable now but its cost missed the
    // window. The day-end flush must still exclude it with COST_DEADLINE_MISSED.
    await seedLateCostedVariant(org.id, store.id, 'EAN13-FLUSH-LATE', orderDate);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-late',
      orderDate,
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-late',
        barcode: 'EAN13-FLUSH-LATE',
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-late');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  it('a past-day entry whose only profile was archived before its day ended graduates with COST_DEADLINE_MISSED', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    // The variant's only profile was linked long ago but archived one minute before
    // the order's day ended (plan PR-3b): no cost was in force when the day closed,
    // so the day-end flush must exclude it even though the link itself is old.
    await seedVersionedCostVariant(org.id, store.id, 'EAN13-FLUSH-ARCHIVED', {
      archivedAt: new Date(getBusinessDayRange(orderDate).end.getTime() - 60 * 1000),
    });
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-archived',
      orderDate,
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-archived',
        barcode: 'EAN13-FLUSH-ARCHIVED',
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-archived');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  it('excludes a past-day PERMANENT_FAILED entry whose cost arrived after its day on its final flush attempt', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const orderDate = getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS));
    // Same late-cost shape, but the entry reaches the flush via its PERMANENT_FAILED
    // final-attempt pass (loss-proofing). The late cost must not rescue it from
    // COST_DEADLINE_MISSED.
    await seedLateCostedVariant(org.id, store.id, 'EAN13-FLUSH-LATE-PF', orderDate);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-late-pf',
      orderDate,
      status: 'PERMANENT_FAILED',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-late-pf',
        barcode: 'EAN13-FLUSH-LATE-PF',
      }),
    });
    // Faithful PERMANENT_FAILED shape: 4 attempts already spent.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 4, lastError: 'x' },
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-late-pf');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  it('does not exclude a cancelled order at the day-end flush', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // A cancelled order carries no payout and is never excluded, even without a cost.
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-cancelled',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS)),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-cancelled',
        barcode: 'EAN13-FLUSH',
        status: 'CANCELLED',
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-cancelled');
    expect(order.status).toBe('CANCELLED');
    expect(order.profitExcludedAt).toBeNull();
    expect(order.profitExclusionReason).toBeNull();
  });

  it('does NOT flush a today PENDING entry (same-day cost window preserved)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-today',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-today', barcode: 'EAN13-FLUSH' }),
    });

    await processPastDayBufferFlush();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('PENDING');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('leaves PROMOTING / FAILED past-day entries to the promote tick (only PENDING is flushed)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const promoting = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-promoting',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS)),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-promoting', barcode: 'EAN13-FLUSH' }),
    });

    await processPastDayBufferFlush();

    // Untouched by flush — promote owns PROMOTING/FAILED.
    expect(await prisma.livePerformanceBuffer.count({ where: { id: promoting.id } })).toBe(1);
  });

  it('marks FAILED when graduation throws (handed off to the promote retry path)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-bad',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS)),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-bad', invalid: true }),
    });

    await processPastDayBufferFlush();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('FAILED');
    expect(after.attempts).toBe(1);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('graduates a past-day PERMANENT_FAILED entry via the flush tick (loss-proofing), excluded when uncosted', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // A row that exhausted its promote attempts (PERMANENT_FAILED) but now carries
    // graduatable data gets a final graduation attempt on the flush tick BEFORE the
    // 7-day reset cron may reap it: it lands in orders and never vanishes. No cost was
    // ever entered, so the cost-window rule excludes it with COST_DEADLINE_MISSED.
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-perm-recover',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS)),
      status: 'PERMANENT_FAILED',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'flush-perm-recover',
        barcode: 'EAN13-FLUSH',
      }),
    });

    await processPastDayBufferFlush();

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('flush-perm-recover');
    expect(order.profitExcludedAt).not.toBeNull();
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
    const queued = await prisma.profitRecomputeRequest.findUnique({
      where: { orderId: order.id },
    });
    expect(queued?.reason).toBe(ProfitRecomputeReason.ORDER_CHANGED);
    expect(order.promotedFromBufferAt).not.toBeNull();
  });

  it('keeps a past-day PERMANENT_FAILED entry in the buffer when its flush retry still fails', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // Still-corrupt mapped_order, so the flush-tick retry throws again. The row
    // must STAY put (no status demotion, no attempts churn, no order written);
    // only the 7-day reset cron may remove it, and only after the recovery window.
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'flush-perm-stuck',
      orderDate: getBusinessDateAnchor(new Date(Date.now() - 2 * ONE_DAY_MS)),
      status: 'PERMANENT_FAILED',
      mappedOrder: buildMappedOrder({ platformOrderId: 'flush-perm-stuck', invalid: true }),
    });
    // Faithful PERMANENT_FAILED shape: 4 attempts already spent.
    await prisma.livePerformanceBuffer.update({
      where: { id: entry.id },
      data: { attempts: 4, lastError: 'x' },
    });

    await processPastDayBufferFlush();

    const after = await prisma.livePerformanceBuffer.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.status).toBe('PERMANENT_FAILED');
    expect(after.attempts).toBe(4);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });
});

interface HeldTransaction {
  /** The backend pid of the held transaction. */
  readonly pid: number;
  /** Commits the held transaction. */
  readonly release: () => Promise<void>;
}

/**
 * Opens a transaction on another pooled connection, runs one statement in it (its
 * pg_backend_pid) and keeps it open until `release`: an open seller-input writer.
 */
async function holdOpenTransaction(): Promise<HeldTransaction> {
  let markStarted: (pid: number) => void = () => undefined;
  const started = new Promise<number>((resolve) => {
    markStarted = resolve;
  });
  let markReleased: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    markReleased = resolve;
  });
  const holder = prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      markStarted(rows[0]?.pid ?? -1);
      await released;
    },
    { timeout: 30_000 },
  );
  try {
    const pid = await Promise.race([
      started,
      holder.then(() => {
        throw new Error('the held transaction ended before it started');
      }),
    ]);
    return {
      pid,
      release: async () => {
        markReleased();
        await holder;
      },
    };
  } catch (err) {
    markReleased();
    await holder.catch(() => undefined);
    throw err;
  }
}

// Same-day edit window (plan PR-1, P1-15): a past-day entry graduates only once its
// day is settled by the database clock (resolveSettledCutoff), never at the first
// tick after midnight, and a graduation of a settled day creates the order final.
// Every tick here gets an injected database clock.
describe('buffer graduation waits for the settled cutoff', () => {
  const HOUR_MS = 60 * 60 * 1000;

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    resetSettledCutoffMemo();
  });

  /** Today's business-day start: the end T of yesterday's orders. */
  function todayStart(): Date {
    return getBusinessDayRange(new Date()).start;
  }

  it('a past-day PENDING entry is not graduated five seconds after midnight', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const dayEnd = todayStart();
    const orderInstant = new Date(dayEnd.getTime() - HOUR_MS);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'settle-flush',
      orderDate: getBusinessDateAnchor(orderInstant),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'settle-flush',
        barcode: 'EAN13-SETTLE-FLUSH',
        orderDate: orderInstant.toISOString(),
      }),
    });

    await processPastDayBufferFlush(new Date(dayEnd.getTime() + 5_000));

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(1);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);

    // Positive control: at the settle point the same entry graduates.
    await processPastDayBufferFlush(new Date(dayEnd.getTime() + SELLER_INPUT_SETTLE_MS));

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });

  it('a graduated past-day order is created final', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const dayEnd = todayStart();
    const orderInstant = new Date(dayEnd.getTime() - HOUR_MS);
    const orderDate = getBusinessDateAnchor(orderInstant);
    await seedTimelyCostedVariant(org.id, store.id, 'EAN13-SETTLE-FINAL', orderDate);
    await prisma.productVariant.updateMany({
      where: { storeId: store.id, barcode: 'EAN13-SETTLE-FINAL' },
      data: { syncedDimensionalWeight: '2' },
    });
    // Fixture setup: the variant had that desi all day.
    await clearSellerInputHistory(org.id);
    const entries: ReadonlyArray<{ platformOrderId: string; status: BufferEntryStatus }> = [
      { platformOrderId: 'settle-final-flush', status: 'PENDING' },
      { platformOrderId: 'settle-final-promote', status: 'PROMOTING' },
    ];
    for (const { platformOrderId, status } of entries) {
      await createBufferEntry(org.id, store.id, {
        platformOrderId,
        orderDate,
        status,
        mappedOrder: buildMappedOrder({
          platformOrderId,
          barcode: 'EAN13-SETTLE-FINAL',
          orderDate: orderInstant.toISOString(),
        }),
      });
    }
    const dbNow = new Date(dayEnd.getTime() + SELLER_INPUT_SETTLE_MS);

    await processPastDayBufferFlush(dbNow);
    await processBufferPromote({ dbNow });

    expect(await prisma.livePerformanceBuffer.count({ where: { storeId: store.id } })).toBe(0);
    const orders = await prisma.order.findMany({
      where: { storeId: store.id },
      include: { items: true },
      orderBy: { platformOrderId: 'asc' },
    });
    expect(orders.map((order) => order.platformOrderId)).toEqual([
      'settle-final-flush',
      'settle-final-promote',
    ]);
    for (const order of orders) {
      expect(order.sellerInputsFinalAt?.toISOString()).toBe(dbNow.toISOString());
      expect(order.profitExcludedAt).toBeNull();
      // The first capture of a final order still reads the inputs at the day end.
      expect(order.items.map((item) => item.snapshotUnitDesi?.toString())).toEqual(['2']);
    }
  });

  it('a same-day promote creates the order non-final', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, 'EAN13-SETTLE-TODAY');
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'settle-today',
      orderDate: getBusinessDateAnchor(),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'settle-today',
        barcode: 'EAN13-SETTLE-TODAY',
      }),
    });

    await processBufferPromote({ dbNow: new Date() });

    // Positive control: the entry was promoted.
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('settle-today');
    expect(order.sellerInputsFinalAt).toBeNull();
    expect(order.profitExcludedAt).toBeNull();
  });

  it("an unsettled past-day PROMOTING entry is neither promoted nor demoted, and does not block today's entries", async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const dayEnd = todayStart();
    const yesterday = getBusinessDateAnchor(new Date(dayEnd.getTime() - HOUR_MS));
    // A full promote chunk of yesterday's PROMOTING entries, all older than today's.
    const PROMOTE_CHUNK = 25;
    for (let index = 0; index < PROMOTE_CHUNK; index += 1) {
      await createBufferEntry(org.id, store.id, {
        platformOrderId: `settle-yesterday-${index}`,
        orderDate: yesterday,
        status: 'PROMOTING',
        mappedOrder: buildMappedOrder({
          platformOrderId: `settle-yesterday-${index}`,
          barcode: 'EAN13-SETTLE-UNCOSTED',
        }),
      });
    }
    await prisma.livePerformanceBuffer.updateMany({
      where: { organizationId: org.id, storeId: store.id },
      data: { createdAt: new Date(Date.now() - HOUR_MS) },
    });
    await seedCalculableVariant(org.id, store.id, 'EAN13-SETTLE-TODAY-2');
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'settle-today-2',
      orderDate: getBusinessDateAnchor(dayEnd),
      status: 'PROMOTING',
      mappedOrder: buildMappedOrder({
        platformOrderId: 'settle-today-2',
        barcode: 'EAN13-SETTLE-TODAY-2',
      }),
    });

    await processBufferPromote({ dbNow: new Date(dayEnd.getTime() + 5_000) });

    const orders = await prisma.order.findMany({ where: { storeId: store.id } });
    expect(orders.map((order) => order.platformOrderId)).toEqual(['settle-today-2']);
    const waiting = await prisma.livePerformanceBuffer.findMany({
      where: { organizationId: org.id, storeId: store.id },
    });
    expect(waiting).toHaveLength(PROMOTE_CHUNK);
    expect(waiting.every((entry) => entry.status === 'PROMOTING' && entry.attempts === 0)).toBe(
      true,
    );
  });

  it('an open pre-midnight transaction holds graduation back after the settle delay', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    // The day under test is today, closed by an injected clock at tomorrow's start plus
    // the settle delay: every transaction this test opens began before that day end.
    const dayEnd = getBusinessDayRange(new Date()).end;
    const dbNow = new Date(dayEnd.getTime() + SELLER_INPUT_SETTLE_MS);
    const entry = await createBufferEntry(org.id, store.id, {
      platformOrderId: 'settle-held',
      orderDate: getBusinessDateAnchor(),
      status: 'PENDING',
      mappedOrder: buildMappedOrder({ platformOrderId: 'settle-held', barcode: 'EAN13-SETTLE' }),
    });

    const held = await holdOpenTransaction();
    try {
      await processPastDayBufferFlush(dbNow);

      expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(1);
      expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
    } finally {
      await held.release();
    }

    // Positive control: once the writer committed, the same tick graduates it.
    await processPastDayBufferFlush(dbNow);

    expect(await prisma.livePerformanceBuffer.count({ where: { id: entry.id } })).toBe(0);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
  });
});
