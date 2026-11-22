import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createMembership,
  createOrder,
  createOrganization,
  createProfitLine,
  createProfitStatement,
  createStore,
} from '../../../helpers/factories';

/** A real instant `hours` into today's business day (well inside the window). */
function todayAt(hours: number): Date {
  return new Date(getBusinessDayRange().start.getTime() + hours * 60 * 60 * 1000);
}

interface TodayProductsBody {
  data: {
    variantId: string | null;
    barcode: string;
    stockCode: string | null;
    productName: string | null;
    thumbUrl: string | null;
    orderCount: number;
    unitsSold: number;
    revenue: string;
    costStatus: 'costed' | 'missing';
    unitCost: string | null;
    unresolved: boolean;
    vendorMissing: boolean;
    dimensionalWeight: string | null;
    syncedDimensionalWeight: string | null;
    isDimensionalWeightOverridden: boolean;
    isDimensionalWeightMissing: boolean;
  }[];
}

async function createVariant(
  orgId: string,
  storeId: string,
  opts: {
    title: string;
    barcode: string;
    seq: number;
    // Passed through as-is: undefined keeps the column default (synced 0), an
    // explicit null stores an empty desi.
    syncedDimensionalWeight?: string | null;
    dimensionalWeightOverride?: string | null;
    isDigital?: boolean;
  },
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(910000 + opts.seq),
      productMainId: `PM-${opts.seq}`,
      title: opts.title,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(810000 + opts.seq),
      barcode: opts.barcode,
      stockCode: `SC-${opts.seq}`,
      salePrice: '100.00',
      listPrice: '120.00',
      syncedDimensionalWeight: opts.syncedDimensionalWeight,
      dimensionalWeightOverride: opts.dimensionalWeightOverride,
      isDigital: opts.isDigital,
    },
  });
  return variant.id;
}

/** Create `count` of today's orders, each selling one unit of `variantId`. */
async function sellInOrders(
  orgId: string,
  storeId: string,
  variantId: string,
  // GROSS konvansiyon: lineSaleGross = LINE total (× quantity). quantity 1 olduğu
  // için per-unit değerle aynı.
  opts: { count: number; lineSaleGross: string },
): Promise<void> {
  for (let i = 0; i < opts.count; i += 1) {
    const order = await createOrder(orgId, storeId, {
      orderDate: todayAt(10),
      saleGross: opts.lineSaleGross,
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: orgId,
        productVariantId: variantId,
        quantity: 1,
        lineSaleGross: opts.lineSaleGross,
      },
    });
  }
}

describe('GET /v1/.../live-performance/today-products', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('merges orders and buffer into a single row per barcode', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Pamuklu Tişört',
      barcode: 'BC-MERGE',
      seq: 1,
    });

    // Two orders today (2 units, ₺80 revenue) + one buffer entry (3 units, ₺150).
    await sellInOrders(org.id, store.id, variantId, { count: 2, lineSaleGross: '40.00' });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '150.00',
        orderDate: todayAt(11).toISOString(),
        // lineSaleGross = LINE total: 3 × ₺50 = ₺150.
        lines: [{ barcode: 'BC-MERGE', quantity: 3, lineSaleGross: '150.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.variantId).toBe(variantId);
    expect(row?.barcode).toBe('BC-MERGE');
    expect(row?.stockCode).toBe('SC-1');
    expect(row?.productName).toBe('Pamuklu Tişört');
    expect(row?.orderCount).toBe(3); // 2 orders + 1 buffer entry
    expect(row?.unitsSold).toBe(5); // 2 + 3
    expect(row?.revenue).toBe('230.00'); // 80 + 150
    // No cost profile attached → missing.
    expect(row?.costStatus).toBe('missing');
    expect(row?.unitCost).toBeNull();
    expect(row?.unresolved).toBe(false);
  });

  it('çözülemeyen barkodlu buffer satırı listede BARKOD kimliğiyle görünür (düşürülmez)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Katalogda karşılığı OLMAYAN barkod — eager onarım vendor'da da bulamadı
    // senaryosu (görünürlük sözleşmesi, spec 2026-06-12 §7): satır düşürülmez.
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'tp-unresolved-1',
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '90.00',
        orderDate: todayAt(11).toISOString(),
        // lineSaleGross = LINE total: 2 × ₺45 = ₺90.
        lines: [{ barcode: 'GHOST-BARCODE-1', quantity: 2, lineSaleGross: '90.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    const row = body.data.find((r) => r.barcode === 'GHOST-BARCODE-1');
    expect(row).toBeDefined();
    expect(row?.unresolved).toBe(true);
    expect(row?.variantId).toBeNull();
    expect(row?.productName).toBeNull();
    expect(row?.stockCode).toBeNull();
    expect(row?.thumbUrl).toBeNull();
    expect(row?.unitsSold).toBe(2);
    expect(row?.revenue).toBe('90.00');
    expect(row?.costStatus).toBe('missing');
    expect(row?.unitCost).toBeNull();
    // No variant, so no desi state: the row is never counted as missing desi.
    expect(row?.dimensionalWeight).toBeNull();
    expect(row?.syncedDimensionalWeight).toBeNull();
    expect(row?.isDimensionalWeightOverridden).toBe(false);
    expect(row?.isDimensionalWeightMissing).toBe(false);
  });

  it('reports the desi fields of a resolved row', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Buffer path: a physical variant with no seller desi and no marketplace desi.
    const missingId = await createVariant(org.id, store.id, {
      title: 'No Desi Variant',
      barcode: 'BC-NO-DESI',
      seq: 20,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      isDigital: false,
    });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '50.00',
        orderDate: todayAt(11).toISOString(),
        lines: [{ barcode: 'BC-NO-DESI', quantity: 1, lineSaleGross: '50.00' }],
      },
    });

    // Orders path: a variant with only a seller desi.
    const overriddenId = await createVariant(org.id, store.id, {
      title: 'Seller Desi Variant',
      barcode: 'BC-SELLER-DESI',
      seq: 21,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: '2.50',
    });
    await sellInOrders(org.id, store.id, overriddenId, { count: 1, lineSaleGross: '40.00' });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(2);

    const missing = body.data.find((r) => r.variantId === missingId);
    expect(missing).toMatchObject({
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: true,
    });

    const overridden = body.data.find((r) => r.variantId === overriddenId);
    expect(overridden).toMatchObject({
      dimensionalWeight: '2.5',
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
  });

  it('treats a seller desi of 0 as present', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Zero Desi Variant',
      barcode: 'BC-ZERO-DESI',
      seq: 22,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: '0',
    });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '50.00',
        orderDate: todayAt(11).toISOString(),
        lines: [{ barcode: 'BC-ZERO-DESI', quantity: 1, lineSaleGross: '50.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    const row = body.data.find((r) => r.variantId === variantId);
    expect(row).toMatchObject({
      dimensionalWeight: '0',
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
  });

  it('does not flag a digital variant without desi', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Digital Variant',
      barcode: 'BC-DIGITAL',
      seq: 23,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      isDigital: true,
    });
    await sellInOrders(org.id, store.id, variantId, { count: 1, lineSaleGross: '30.00' });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    const row = body.data.find((r) => r.variantId === variantId);
    expect(row).toMatchObject({
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
  });

  it('derives vendorMissing on unresolved buffer rows from CatalogBarcodeMiss', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Unresolved buffer line A: barcode is a CONFIRMED catalog gap.
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'tp-vm-confirmed',
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '45.00',
        orderDate: todayAt(11).toISOString(),
        lines: [{ barcode: 'GAP-CONFIRMED', quantity: 1, lineSaleGross: '45.00' }],
      },
    });
    // Unresolved buffer line B: no miss row → vendorMissing false ("eşleşme bekliyor").
    await createBufferEntry(org.id, store.id, {
      platformOrderId: 'tp-vm-awaiting',
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '55.00',
        orderDate: todayAt(12).toISOString(),
        lines: [{ barcode: 'AWAITING-MATCH', quantity: 1, lineSaleGross: '55.00' }],
      },
    });
    await prisma.catalogBarcodeMiss.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        barcode: 'GAP-CONFIRMED',
        vendorMissing: true,
      },
    });
    // Transient miss (vendorMissing=false) must NOT flip the badge.
    await prisma.catalogBarcodeMiss.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        barcode: 'AWAITING-MATCH',
        vendorMissing: false,
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    const confirmed = body.data.find((r) => r.barcode === 'GAP-CONFIRMED');
    expect(confirmed?.unresolved).toBe(true);
    expect(confirmed?.vendorMissing).toBe(true);

    const awaiting = body.data.find((r) => r.barcode === 'AWAITING-MATCH');
    expect(awaiting?.unresolved).toBe(true);
    expect(awaiting?.vendorMissing).toBe(false);
  });

  it('reports vendorMissing=false on a resolved row even if its barcode has a vendor-missing row', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Resolved variant sold today; a stale miss row exists for the same barcode.
    // vendorMissing is meaningless for resolved rows and must be false.
    const variantId = await createVariant(org.id, store.id, {
      title: 'Eşleşmiş Ürün',
      barcode: 'RESOLVED-BC',
      seq: 7,
    });
    await sellInOrders(org.id, store.id, variantId, { count: 1, lineSaleGross: '60.00' });
    await prisma.catalogBarcodeMiss.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        barcode: 'RESOLVED-BC',
        vendorMissing: true,
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    const row = body.data.find((r) => r.variantId === variantId);
    expect(row?.unresolved).toBe(false);
    expect(row?.vendorMissing).toBe(false);
  });

  it("surfaces the unit cost from the order's cost lines", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Costed variant: an active profile + a today order carrying a stored ESTIMATE
    // statement and a 30 COST_COGS line (qty 1). The displayed unit cost is derived
    // from the item's cost lines (itemProfitValues), not from a legacy snapshot column.
    const costedId = await createVariant(org.id, store.id, {
      title: 'Costed Variant',
      barcode: 'BC-COSTED',
      seq: 2,
    });
    const profile = await createCostProfile(org.id);
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: costedId,
        profileId: profile.id,
        attachedBy: user.id,
      },
    });
    const order = await createOrder(org.id, store.id, {
      orderDate: todayAt(10),
      saleGross: '60.00',
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: org.id,
        productVariantId: costedId,
        quantity: 1,
        lineSaleGross: '60.00',
      },
    });
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '5.00',
      saleMarginPct: '8.33',
    });
    await createProfitLine(order.id, org.id, store.id, {
      orderItemId: item.id,
      type: 'COST_COGS',
      certainty: 'ACTUAL',
      source: 'SELLER_INPUT',
      amountGross: '30.00',
      amountVat: '5.00',
      vatRatePct: '20',
    });

    // Cost-missing variant: buffer only, no profile.
    const missingId = await createVariant(org.id, store.id, {
      title: 'Missing Variant',
      barcode: 'BC-MISSING',
      seq: 3,
    });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '90.00',
        orderDate: todayAt(12).toISOString(),
        // lineSaleGross = LINE total: 1 × ₺90 = ₺90.
        lines: [{ barcode: 'BC-MISSING', quantity: 1, lineSaleGross: '90.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(2);

    const costed = body.data.find((r) => r.variantId === costedId);
    expect(costed?.costStatus).toBe('costed');
    expect(costed?.unitCost).toBe('30.00');

    const missing = body.data.find((r) => r.variantId === missingId);
    expect(missing?.costStatus).toBe('missing');
    expect(missing?.unitCost).toBeNull();
  });

  it('reports costed with a null unitCost when the order has no stored statement', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Active cost profile attached, but today's order has no stored ESTIMATE statement
    // yet (the writer has not caught up), so no cost line backs a unit cost. Cost
    // status is authoritative from the profile; the displayed unit cost stays null.
    const costedId = await createVariant(org.id, store.id, {
      title: 'Costed No-Statement Variant',
      barcode: 'BC-NO-STATEMENT',
      seq: 4,
    });
    const profile = await createCostProfile(org.id);
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: costedId,
        profileId: profile.id,
        attachedBy: user.id,
      },
    });
    await sellInOrders(org.id, store.id, costedId, { count: 1, lineSaleGross: '50.00' });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(1);

    const row = body.data[0];
    expect(row?.variantId).toBe(costedId);
    expect(row?.costStatus).toBe('costed');
    expect(row?.unitCost).toBeNull();
  });

  it('keeps the list when a stored profit line is corrupt', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A today order selling the variant, with a stored ESTIMATE statement and a profit
    // line whose `inputs` is a nested object -- a shape the reader rejects. Rebuilding
    // the stored lines throws, so the list must still return with a null unit cost and
    // log the failure (owner decision 2026-11-04); volume is unaffected.
    const variantId = await createVariant(org.id, store.id, {
      title: 'Corrupt Line Variant',
      barcode: 'BC-CORRUPT',
      seq: 10,
    });
    const order = await createOrder(org.id, store.id, {
      orderDate: todayAt(10),
      saleGross: '60.00',
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: org.id,
        productVariantId: variantId,
        quantity: 1,
        lineSaleGross: '60.00',
      },
    });
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '5.00',
      saleMarginPct: '8.33',
    });
    await createProfitLine(order.id, org.id, store.id, {
      orderItemId: item.id,
      type: 'COST_COGS',
      certainty: 'ESTIMATE',
      source: 'SELLER_INPUT',
      amountGross: '30.00',
      amountVat: '5.00',
      vatRatePct: '20',
      inputs: { nested: { reason: 'corrupt' } },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as TodayProductsBody;
      expect(body.data).toHaveLength(1);
      const row = body.data[0];
      expect(row?.variantId).toBe(variantId);
      // Volume still reported; only the unit cost falls back to null.
      expect(row?.unitsSold).toBe(1);
      expect(row?.revenue).toBe('60.00');
      expect(row?.unitCost).toBeNull();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[profit-read] in-request profit computation failed',
        expect.objectContaining({ surface: 'today-products', orderId: null }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('prefers a computed order over an earlier not-computable one for the unit cost', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Preferred Variant',
      barcode: 'BC-PREFER',
      seq: 11,
    });

    // Earlier order: its ESTIMATE statement never reached ESTIMATED and it carries no
    // cost line, so if it backed the unit cost the row would read 0.00.
    const earlier = await createOrder(org.id, store.id, {
      orderDate: todayAt(9),
      saleGross: '60.00',
    });
    await prisma.orderItem.create({
      data: {
        orderId: earlier.id,
        organizationId: org.id,
        productVariantId: variantId,
        quantity: 1,
        lineSaleGross: '60.00',
      },
    });
    await createProfitStatement(earlier.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'NOT_COMPUTABLE',
      netProfit: null,
    });

    // Later order: its ESTIMATE statement is ESTIMATED with a 30.00 cost line (qty 1).
    const later = await createOrder(org.id, store.id, {
      orderDate: todayAt(11),
      saleGross: '60.00',
    });
    const laterItem = await prisma.orderItem.create({
      data: {
        orderId: later.id,
        organizationId: org.id,
        productVariantId: variantId,
        quantity: 1,
        lineSaleGross: '60.00',
      },
    });
    await createProfitStatement(later.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '5.00',
      saleMarginPct: '8.33',
    });
    await createProfitLine(later.id, org.id, store.id, {
      orderItemId: laterItem.id,
      type: 'COST_COGS',
      certainty: 'ESTIMATE',
      source: 'SELLER_INPUT',
      amountGross: '30.00',
      amountVat: '5.00',
      vatRatePct: '20',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.variantId).toBe(variantId);
    expect(row?.unitsSold).toBe(2);
    // The ESTIMATED (later) order backs the unit cost, not the earlier not-computable one.
    expect(row?.unitCost).toBe('30.00');
  });

  it('picks the next order when the first has no statement', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Next Order Variant',
      barcode: 'BC-NEXT',
      seq: 12,
    });

    // Earliest order has no ESTIMATE statement yet (the writer has not caught up), so it
    // is not a unit-cost candidate at all.
    const first = await createOrder(org.id, store.id, {
      orderDate: todayAt(9),
      saleGross: '60.00',
    });
    await prisma.orderItem.create({
      data: {
        orderId: first.id,
        organizationId: org.id,
        productVariantId: variantId,
        quantity: 1,
        lineSaleGross: '60.00',
      },
    });

    // Next order: ESTIMATED with a 30.00 cost line (qty 1) -- the unit cost source.
    const next = await createOrder(org.id, store.id, {
      orderDate: todayAt(11),
      saleGross: '60.00',
    });
    const nextItem = await prisma.orderItem.create({
      data: {
        orderId: next.id,
        organizationId: org.id,
        productVariantId: variantId,
        quantity: 1,
        lineSaleGross: '60.00',
      },
    });
    await createProfitStatement(next.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '5.00',
      saleMarginPct: '8.33',
    });
    await createProfitLine(next.id, org.id, store.id, {
      orderItemId: nextItem.id,
      type: 'COST_COGS',
      certainty: 'ESTIMATE',
      source: 'SELLER_INPUT',
      amountGross: '30.00',
      amountVat: '5.00',
      vatRatePct: '20',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.variantId).toBe(variantId);
    expect(row?.unitsSold).toBe(2);
    expect(row?.unitCost).toBe('30.00');
  });

  it('reports zero unit cost when the statement has no cost line', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A today order with an ESTIMATED estimate statement but no cost line. itemProfitValues
    // reports a 0.00 unit cost for an item with no cost line (and no MISSING_COST issue).
    const variantId = await createVariant(org.id, store.id, {
      title: 'Zero Cost Variant',
      barcode: 'BC-ZEROCOST',
      seq: 13,
    });
    const order = await createOrder(org.id, store.id, {
      orderDate: todayAt(10),
      saleGross: '60.00',
    });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        organizationId: org.id,
        productVariantId: variantId,
        quantity: 1,
        lineSaleGross: '60.00',
      },
    });
    await createProfitStatement(order.id, org.id, store.id, {
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      netProfit: '5.00',
      saleMarginPct: '8.33',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TodayProductsBody;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.variantId).toBe(variantId);
    expect(row?.unitCost).toBe('0.00');
  });
});
