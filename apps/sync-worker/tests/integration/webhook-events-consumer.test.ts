/**
 * Webhook-events consumer tick (Paket D §D4).
 *
 * Real DB. The handler is invoked directly (no timer). The vendor side is the
 * only thing guarded — a global.fetch tripwire throws so no test can leak a live
 * catalog lookup; every barcode used here is either catalogued (no vendor call)
 * or the payload fails before intake (fee resolution throws).
 *
 * Times are written onto rows (nextProcessAt / processAttempts) instead of faking
 * a clock: the lease + backoff decisions run against the DB `now()`, so seeding a
 * past/future `next_process_at` is the faithful way to exercise eligibility.
 */
import { prisma } from '@pazarsync/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { processWebhookEventsBatch } from '../../src/handlers/webhook-events-consumer';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';
import {
  createCostProfile,
  createOrganization,
  createStore,
  createWebhookEvent,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureFeeDefinitions } from '../../../../apps/api/tests/helpers/seed-fee-definitions';

const SELLER_ID = 55555;
const CALCULABLE_BARCODE = 'EAN13-CONSUMER-001';
// Order dates must fall after the FeeDefinition seed (effectiveFrom 2026-05-18).
const ORDER_DATE_MS = Date.UTC(2026, 4, 19);
const LAST_MODIFIED_MS = Date.UTC(2026, 4, 20);

interface PayloadOverrides {
  shipmentPackageId?: number;
  orderNumber?: string;
  status?: string;
  barcode?: string;
}

/**
 * A full TrendyolShipmentPackage-shaped webhook body (what the receiver route
 * persists to `webhook_events.rawPayload`). Carries the load-bearing fields the
 * schema validates plus the extra fields the mapper consumes.
 */
function makeWebhookPayload(over: PayloadOverrides = {}): Record<string, unknown> {
  return {
    orderNumber: over.orderNumber ?? '11101228441',
    shipmentPackageId: over.shipmentPackageId ?? 4834026801,
    status: over.status ?? 'Delivered',
    orderDate: ORDER_DATE_MS,
    lastModifiedDate: LAST_MODIFIED_MS,
    agreedDeliveryDate: Date.UTC(2026, 4, 21),
    fastDelivery: false,
    micro: false,
    packageGrossAmount: 120,
    packageTotalPrice: 120,
    supplierId: SELLER_ID,
    lines: [
      {
        lineId: 1,
        sellerId: SELLER_ID,
        barcode: over.barcode ?? CALCULABLE_BARCODE,
        quantity: 1,
        lineUnitPrice: 120,
        lineGrossAmount: 120,
        lineSellerDiscount: 0,
        vatRate: 20,
        commission: 10,
      },
    ],
    packageHistories: [{ status: 'Delivered', createdDate: LAST_MODIFIED_MS }],
  };
}

/** Seed a cost-attached (calculable) variant so intake routes to `orders`. */
async function seedCalculableVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
): Promise<void> {
  const profile = await createCostProfile(organizationId, { storeId, amountGross: '48.00' });
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${barcode}`,
      title: 'Consumer Test Product',
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

describe('processWebhookEventsBatch', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
    // Vendor tripwire: no consumer path here should ever hit the network (every
    // barcode is catalogued, or the payload fails before catalog repair).
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      throw new Error(`vendor must not be called: ${String(input)}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processes a fresh eligible event → order written, processedAt stamped, no error', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, CALCULABLE_BARCODE);
    const event = await createWebhookEvent(org.id, store.id, {
      platformOrderId: '4834026801',
      rawPayload: makeWebhookPayload(),
    });

    const closed = await processWebhookEventsBatch(prisma);

    expect(closed).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('4834026801');
    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.processedAt).not.toBeNull();
    expect(after.processingError).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('respects the lease window: a future next_process_at row is left untouched', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, CALCULABLE_BARCODE);
    const event = await createWebhookEvent(org.id, store.id, {
      rawPayload: makeWebhookPayload(),
    });
    // Held lease / backoff still in effect → the prefilter must skip it.
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { nextProcessAt: new Date(Date.now() + 10 * 60_000) },
    });

    const closed = await processWebhookEventsBatch(prisma);

    expect(closed).toBe(0);
    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.processAttempts).toBe(0);
    expect(after.processedAt).toBeNull();
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('transient fault → backoff (unprocessed, attempts=1, future retry), then replays once eligible', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, CALCULABLE_BARCODE);
    const event = await createWebhookEvent(org.id, store.id, {
      rawPayload: makeWebhookPayload(),
    });
    // Remove the COMMISSION_INVOICE definition the processor resolves FIRST so
    // fee resolution throws — a TRANSIENT fault (missing seed, not a bad payload).
    await prisma.feeDefinition.deleteMany({ where: { feeType: 'COMMISSION_INVOICE' } });

    const before = Date.now();
    const firstClosed = await processWebhookEventsBatch(prisma);

    expect(firstClosed).toBe(0);
    const afterFail = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(afterFail.processedAt).toBeNull();
    expect(afterFail.processingError).not.toBeNull();
    expect(afterFail.processAttempts).toBe(1);
    expect(afterFail.nextProcessAt).not.toBeNull();
    expect(afterFail.nextProcessAt!.getTime()).toBeGreaterThan(before);
    // attempt-1 backoff is 1 min — comfortably under this loose upper bound.
    expect(afterFail.nextProcessAt!.getTime()).toBeLessThan(before + 5 * 60_000);
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);

    // Seed returns and the backoff window elapses (simulated by clearing the
    // retry gate) → the next tick replays the SAME row to completion.
    await ensureFeeDefinitions();
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { nextProcessAt: new Date(Date.now() - 1_000) },
    });

    const secondClosed = await processWebhookEventsBatch(prisma);

    expect(secondClosed).toBe(1);
    const afterReplay = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(afterReplay.processedAt).not.toBeNull();
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(1);
  });

  it('exhausts the attempt cap → terminal close (processedAt + attempt-limit error)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, CALCULABLE_BARCODE);
    const event = await createWebhookEvent(org.id, store.id, {
      rawPayload: makeWebhookPayload(),
    });
    // 4 attempts already spent + the retry gate open → this tick's claim bumps it
    // to the MAX-th attempt; the processing failure is then terminal.
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processAttempts: 4, nextProcessAt: new Date(Date.now() - 1_000) },
    });
    // Force the processing failure at fee resolution.
    await prisma.feeDefinition.deleteMany({ where: { feeType: 'COMMISSION_INVOICE' } });

    const closed = await processWebhookEventsBatch(prisma);

    // Terminal failure is recorded inside recordTransientProcessingFailure (not
    // counted as a fresh close), so the batch reports zero closed this tick.
    expect(closed).toBe(0);
    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.processedAt).not.toBeNull();
    expect(after.processingError).toContain('attempt limit exhausted');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  it('schema drift → deterministic close (processedAt + drift error), no order', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const event = await createWebhookEvent(org.id, store.id, {
      // Not a Trendyol webhook body — fails safeParse deterministically.
      rawPayload: { foo: 'bar' },
    });

    const closed = await processWebhookEventsBatch(prisma);

    expect(closed).toBe(1);
    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.processedAt).not.toBeNull();
    expect(after.processingError).toContain('payload schema drift');
    expect(await prisma.order.count({ where: { storeId: store.id } })).toBe(0);
  });

  // Scenario "store not found" is deliberately omitted: WebhookEvent.store has an
  // onDelete: Cascade FK, so an event whose store was deleted is removed with it —
  // there is no supported way to persist an event pointing at a missing store to
  // exercise the consumer's defensive store-not-found stamp. The stamp exists for
  // the sub-transaction sliver before a cascade commits, which is not reproducible
  // from the test seam.

  it('same-process overlap guard: a concurrent invocation is a no-op (no claim, returns 0)', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    await seedCalculableVariant(org.id, store.id, CALCULABLE_BARCODE);
    const event = await createWebhookEvent(org.id, store.id, { rawPayload: makeWebhookPayload() });

    // First call blocks inside the injected processor, so the tick stays in flight
    // long enough for a second, overlapping call to race it.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hangingProcess = vi.fn(async (): Promise<void> => {
      await gate;
    });

    const first = processWebhookEventsBatch(prisma, { processEvent: hangingProcess });
    // Yield so the first call claims the row and reaches the awaited gate.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The overlapping second call must short-circuit on tickInFlight → 0, and it
    // must never claim the row.
    const secondClosed = await processWebhookEventsBatch(prisma);
    expect(secondClosed).toBe(0);
    // Claimed exactly once (by the first call): a second claim would bump this to 2.
    const mid = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(mid.processAttempts).toBe(1);

    release();
    const firstClosed = await first;
    expect(firstClosed).toBe(1);
    // The processor ran exactly once — the guard prevented a second dispatch.
    expect(hangingProcess).toHaveBeenCalledTimes(1);
  });

  it('deferred cutover, end to end: a route-shaped unleased row is claimed and processed in one tick', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const barcode = 'EAN13-CONSUMER-DEFERRED';
    await seedCalculableVariant(org.id, store.id, barcode);
    // Exactly what the receiver route leaves behind in deferred mode: a fresh row,
    // unleased (processAttempts 0, nextProcessAt null, processedAt null). No route
    // is exercised — this is the DB-level proof of the cutover path.
    const event = await createWebhookEvent(org.id, store.id, {
      platformOrderId: '4834026999',
      rawPayload: makeWebhookPayload({
        shipmentPackageId: 4834026999,
        orderNumber: 'deferred-e2e-1',
        barcode,
      }),
    });

    const closed = await processWebhookEventsBatch(prisma);

    expect(closed).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { storeId: store.id } });
    expect(order.platformOrderId).toBe('4834026999');
    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(after.processedAt).not.toBeNull();
    expect(after.processingError).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
