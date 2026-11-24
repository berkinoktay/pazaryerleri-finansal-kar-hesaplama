import { CostProfileType } from '@pazarsync/db/enums';
import { chooseOrderCostVersion, costDecisionTime, loadSellerInputsAt } from '@pazarsync/profit';
import { getBusinessDateAnchor, getBusinessDayRange } from '@pazarsync/utils';
import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { archiveCostProfile, updateCostProfile } from '@/services/cost-profile.service';
import { detachCostProfiles } from '@/services/cost-profile-attachment.service';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createMembership,
  createOrder,
  createOrganization,
  createProductVariant,
  createProfitLine,
  createProfitStatement,
  createStore,
  type CreateOrderOverrides,
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
    currentCostTry: string | null;
    profileCount: number;
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
    // Fixed variant id, for tests that depend on id order.
    id?: string;
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
      id: opts.id,
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

/**
 * Create one of today's orders with a single line that carries its own barcode, with or
 * without a variant link. Returns the order item id.
 */
async function sellLine(
  orgId: string,
  storeId: string,
  opts: {
    productVariantId: string | null;
    barcode: string | null;
    quantity: number;
    // LINE total (already x quantity).
    lineSaleGross: string;
    status?: CreateOrderOverrides['status'];
  },
): Promise<string> {
  const order = await createOrder(orgId, storeId, {
    orderDate: todayAt(10),
    saleGross: opts.lineSaleGross,
    status: opts.status,
  });
  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      organizationId: orgId,
      productVariantId: opts.productVariantId,
      barcode: opts.barcode,
      quantity: opts.quantity,
      lineSaleGross: opts.lineSaleGross,
    },
  });
  return item.id;
}

/** Link a cost profile to a variant (the link row the attach service writes). */
async function attachProfile(orgId: string, variantId: string, profileId: string): Promise<void> {
  await prisma.productVariantCostProfile.create({
    data: { organizationId: orgId, productVariantId: variantId, profileId },
  });
}

/** GET today-products for `org`/`store` as `user`; asserts 200 and returns the rows. */
async function fetchTodayProducts(
  app: ReturnType<typeof createApp>,
  args: { orgId: string; storeId: string; accessToken: string },
): Promise<TodayProductsBody['data']> {
  const res = await app.request(
    `/v1/organizations/${args.orgId}/stores/${args.storeId}/live-performance/today-products`,
    { headers: { Authorization: bearer(args.accessToken) } },
  );
  expect(res.status).toBe(200);
  const body: TodayProductsBody = await res.json();
  return body.data;
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
    expect(row?.currentCostTry).toBeNull();
    expect(row?.profileCount).toBe(0);
    expect(row?.unresolved).toBe(false);
  });

  it('keeps one desi state when a product sells in both orders and the buffer', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // A physical variant with no seller desi and no marketplace desi.
    const variantId = await createVariant(org.id, store.id, {
      title: 'Merged No Desi',
      barcode: 'BC-MERGE-DESI',
      seq: 2,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      isDigital: false,
    });
    await sellInOrders(org.id, store.id, variantId, { count: 1, lineSaleGross: '40.00' });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '50.00',
        orderDate: todayAt(11).toISOString(),
        lines: [{ barcode: 'BC-MERGE-DESI', quantity: 1, lineSaleGross: '50.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      variantId,
      orderCount: 2, // 1 order + 1 buffer entry
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: true,
    });
  });

  it('shows the lower-id variant when two variants share a buffered barcode', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // The higher id is inserted first, so only an explicit id order (not the
    // insertion order) picks the lower one, as the calculability gate does.
    await createVariant(org.id, store.id, {
      title: 'Shared High',
      barcode: 'BC-SHARED',
      seq: 3,
      syncedDimensionalWeight: '2.00',
      id: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
    });
    const lowId = await createVariant(org.id, store.id, {
      title: 'Shared Low',
      barcode: 'BC-SHARED',
      seq: 4,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      id: '00000000-0000-4000-8000-000000000001',
    });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '50.00',
        orderDate: todayAt(11).toISOString(),
        lines: [{ barcode: 'BC-SHARED', quantity: 1, lineSaleGross: '50.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      variantId: lowId,
      productName: 'Shared Low',
      isDimensionalWeightMissing: true,
    });
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
    expect(row?.currentCostTry).toBeNull();
    expect(row?.profileCount).toBe(0);
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

  it("shows the current profile amount, not the amount today's order was calculated with", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Costed variant: an active 45.00 profile + a today order whose stored ESTIMATE
    // statement was calculated with a 30.00 COST_COGS line (qty 1). The column shows
    // the profile's current amount, not the amount the order's cost line carries.
    const costedId = await createVariant(org.id, store.id, {
      title: 'Costed Variant',
      barcode: 'BC-COSTED',
      seq: 2,
    });
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '45.00' });
    await attachProfile(org.id, costedId, profile.id);
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
    expect(costed?.currentCostTry).toBe('45.00');
    expect(costed?.profileCount).toBe(1);

    const missing = body.data.find((r) => r.variantId === missingId);
    expect(missing?.costStatus).toBe('missing');
    expect(missing?.currentCostTry).toBeNull();
    expect(missing?.profileCount).toBe(0);
  });

  it("shows the current cost when today's order has no stored statement", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Active 60.00 profile attached, but today's order has no stored ESTIMATE statement
    // yet (the writer has not caught up). The current cost does not wait for it.
    const costedId = await createVariant(org.id, store.id, {
      title: 'Costed No-Statement Variant',
      barcode: 'BC-NO-STATEMENT',
      seq: 4,
    });
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '60.00' });
    await attachProfile(org.id, costedId, profile.id);
    await sellInOrders(org.id, store.id, costedId, { count: 1, lineSaleGross: '50.00' });

    const rows = await fetchTodayProducts(app, {
      orgId: org.id,
      storeId: store.id,
      accessToken: user.accessToken,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variantId: costedId,
      costStatus: 'costed',
      currentCostTry: '60.00',
      profileCount: 1,
    });
  });

  it('a buffer-only product with a profile shows its current cost', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Sold only through the buffer: no order row, so no statement and no cost line.
    const variantId = await createVariant(org.id, store.id, {
      title: 'Buffer Only Variant',
      barcode: 'BC-BUFFER-ONLY',
      seq: 5,
    });
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '25.00' });
    await attachProfile(org.id, variantId, profile.id);
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '90.00',
        orderDate: todayAt(12).toISOString(),
        lines: [{ barcode: 'BC-BUFFER-ONLY', quantity: 1, lineSaleGross: '90.00' }],
      },
    });

    const rows = await fetchTodayProducts(app, {
      orgId: org.id,
      storeId: store.id,
      accessToken: user.accessToken,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variantId,
      costStatus: 'costed',
      currentCostTry: '25.00',
      profileCount: 1,
    });
  });

  it('sums two active profiles', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Two Profiles Variant',
      barcode: 'BC-TWO-PROFILES',
      seq: 6,
    });
    const cogs = await createCostProfile(org.id, {
      storeId: store.id,
      type: CostProfileType.COGS,
      amountGross: '30.00',
    });
    const packaging = await createCostProfile(org.id, {
      storeId: store.id,
      type: CostProfileType.PACKAGING,
      amountGross: '12.50',
    });
    await attachProfile(org.id, variantId, cogs.id);
    await attachProfile(org.id, variantId, packaging.id);
    await sellInOrders(org.id, store.id, variantId, { count: 1, lineSaleGross: '100.00' });

    const rows = await fetchTodayProducts(app, {
      orgId: org.id,
      storeId: store.id,
      accessToken: user.accessToken,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variantId,
      costStatus: 'costed',
      currentCostTry: '42.50',
      profileCount: 2,
    });
  });

  it('an archived profile is not summed and does not make the variant costed', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // Variant X: one active 30.00 profile and one archived 99.00 profile.
    const variantX = await createVariant(org.id, store.id, {
      title: 'Active And Archived Variant',
      barcode: 'BC-ARCHIVED-X',
      seq: 8,
    });
    const activeX = await createCostProfile(org.id, { storeId: store.id, amountGross: '30.00' });
    const archivedX = await createCostProfile(org.id, { storeId: store.id, amountGross: '99.00' });
    await attachProfile(org.id, variantX, activeX.id);
    await attachProfile(org.id, variantX, archivedX.id);
    await sellInOrders(org.id, store.id, variantX, { count: 2, lineSaleGross: '100.00' });

    // Variant Y: only an archived profile.
    const variantY = await createVariant(org.id, store.id, {
      title: 'Archived Only Variant',
      barcode: 'BC-ARCHIVED-Y',
      seq: 9,
    });
    const archivedY = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });
    await attachProfile(org.id, variantY, archivedY.id);
    await sellInOrders(org.id, store.id, variantY, { count: 1, lineSaleGross: '100.00' });

    // Through the real service: the profile row and its archived version are written
    // together, the state the cost rule reads.
    await archiveCostProfile(org.id, archivedX.id, user.id);
    await archiveCostProfile(org.id, archivedY.id, user.id);

    const rows = await fetchTodayProducts(app, {
      orgId: org.id,
      storeId: store.id,
      accessToken: user.accessToken,
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.variantId === variantX)).toMatchObject({
      costStatus: 'costed',
      currentCostTry: '30.00',
      profileCount: 1,
    });
    expect(rows.find((r) => r.variantId === variantY)).toMatchObject({
      costStatus: 'missing',
      currentCostTry: null,
      profileCount: 0,
    });
  });

  it('a zero-amount profile is costed with a 0.00 current cost', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Zero Cost Variant',
      barcode: 'BC-ZEROCOST',
      seq: 13,
    });
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '0.00' });
    await attachProfile(org.id, variantId, profile.id);
    await sellInOrders(org.id, store.id, variantId, { count: 1, lineSaleGross: '60.00' });

    const rows = await fetchTodayProducts(app, {
      orgId: org.id,
      storeId: store.id,
      accessToken: user.accessToken,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variantId,
      costStatus: 'costed',
      currentCostTry: '0.00',
      profileCount: 1,
    });
  });

  it('reports each variant of one product with its own current cost', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const firstId = await createVariant(org.id, store.id, {
      title: 'Two Variant Product',
      barcode: 'BC-SIBLING-1',
      seq: 14,
    });
    const first = await prisma.productVariant.findUniqueOrThrow({
      where: { id: firstId },
      select: { productId: true },
    });
    const second = await createProductVariant(org.id, store.id, first.productId, {
      barcode: 'BC-SIBLING-2',
    });
    const firstProfile = await createCostProfile(org.id, {
      storeId: store.id,
      amountGross: '10.00',
    });
    const secondProfile = await createCostProfile(org.id, {
      storeId: store.id,
      amountGross: '20.00',
    });
    await attachProfile(org.id, firstId, firstProfile.id);
    await attachProfile(org.id, second.id, secondProfile.id);
    await sellInOrders(org.id, store.id, firstId, { count: 1, lineSaleGross: '50.00' });
    await sellInOrders(org.id, store.id, second.id, { count: 1, lineSaleGross: '60.00' });

    const rows = await fetchTodayProducts(app, {
      orgId: org.id,
      storeId: store.id,
      accessToken: user.accessToken,
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.variantId === firstId)).toMatchObject({
      costStatus: 'costed',
      currentCostTry: '10.00',
      profileCount: 1,
    });
    expect(rows.find((r) => r.variantId === second.id)).toMatchObject({
      costStatus: 'costed',
      currentCostTry: '20.00',
      profileCount: 1,
    });
  });

  it('a digital variant shows its current cost like any other', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Digital Costed Variant',
      barcode: 'BC-DIGITAL-COST',
      seq: 15,
      syncedDimensionalWeight: null,
      dimensionalWeightOverride: null,
      isDigital: true,
    });
    const profile = await createCostProfile(org.id, { storeId: store.id, amountGross: '15.00' });
    await attachProfile(org.id, variantId, profile.id);
    await sellInOrders(org.id, store.id, variantId, { count: 1, lineSaleGross: '30.00' });

    const rows = await fetchTodayProducts(app, {
      orgId: org.id,
      storeId: store.id,
      accessToken: user.accessToken,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      variantId,
      costStatus: 'costed',
      currentCostTry: '15.00',
      profileCount: 1,
      isDimensionalWeightMissing: false,
    });
  });

  it("the current cost equals what the cost rule gives today's orders", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Parity Variant',
      barcode: 'BC-PARITY',
      seq: 16,
    });
    const cogs = await createCostProfile(org.id, { storeId: store.id, amountGross: '20.00' });
    const packaging = await createCostProfile(org.id, {
      storeId: store.id,
      type: CostProfileType.PACKAGING,
      amountGross: '7.25',
    });
    await attachProfile(org.id, variantId, cogs.id);
    await attachProfile(org.id, variantId, packaging.id);
    // A second version through the real service: the cost rule prices the link by it.
    await updateCostProfile(org.id, cogs.id, { amountGross: '33.30' }, user.id);
    // An archived profile and a detached link, both through the real services: neither
    // counts for the column nor for the cost rule.
    const archived = await createCostProfile(org.id, { storeId: store.id, amountGross: '50.00' });
    await attachProfile(org.id, variantId, archived.id);
    await archiveCostProfile(org.id, archived.id, user.id);
    const detached = await createCostProfile(org.id, { storeId: store.id, amountGross: '60.00' });
    await attachProfile(org.id, variantId, detached.id);
    await detachCostProfiles(org.id, [detached.id], [variantId], null);
    await sellInOrders(org.id, store.id, variantId, { count: 1, lineSaleGross: '100.00' });

    // What the cost rule gives today's orders: each link in force at the day end,
    // priced by its version in force then.
    const at = costDecisionTime(new Date());
    const inputs = await loadSellerInputsAt(prisma, {
      organizationId: org.id,
      variantIds: [variantId],
      at,
    });
    const links = inputs.get(variantId)?.costProfiles ?? [];
    const expected = links.reduce((sum, link) => {
      const version = chooseOrderCostVersion(link, { at });
      return version === null ? sum : sum.add(version.amountGross.toString());
    }, new Decimal(0));
    // Not vacuous: the updated profile is priced by its second version (33.30 + 7.25);
    // the archived 50.00 and the detached 60.00 add nothing.
    expect(expected.toFixed(2)).toBe('40.55');

    const rows = await fetchTodayProducts(app, {
      orgId: org.id,
      storeId: store.id,
      accessToken: user.accessToken,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.currentCostTry).toBe(expected.toFixed(2));
    expect(rows[0]?.profileCount).toBe(2);
  });

  it('keeps a today order line whose variant was deleted, as an unresolved barcode row', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Deleted Variant',
      barcode: 'BC-DELETED',
      seq: 30,
    });
    await sellLine(org.id, store.id, {
      productVariantId: variantId,
      barcode: 'BC-DELETED',
      quantity: 2,
      lineSaleGross: '80.00',
    });
    // The item's variant FK is ON DELETE SET NULL: the line stays, variantless.
    await prisma.productVariant.delete({ where: { id: variantId } });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      variantId: null,
      barcode: 'BC-DELETED',
      stockCode: null,
      productName: null,
      thumbUrl: null,
      orderCount: 1,
      unitsSold: 2,
      revenue: '80.00',
      costStatus: 'missing',
      currentCostTry: null,
      profileCount: 0,
      unresolved: true,
      vendorMissing: false,
      isDimensionalWeightMissing: false,
    });
  });

  it('keeps a today order line born without a variant', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await sellLine(org.id, store.id, {
      productVariantId: null,
      barcode: 'BC-BORN-ORPHAN',
      quantity: 1,
      lineSaleGross: '35.00',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      variantId: null,
      barcode: 'BC-BORN-ORPHAN',
      orderCount: 1,
      unitsSold: 1,
      revenue: '35.00',
      costStatus: 'missing',
      unresolved: true,
      vendorMissing: false,
    });
  });

  it('resolves a variantless line by barcode to the current catalog variant and merges it with the buffer sale', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    // The catalog variant now carrying the barcode (e.g. re-created after a delete).
    const variantId = await createVariant(org.id, store.id, {
      title: 'Recreated Variant',
      barcode: 'BC-RECREATED',
      seq: 31,
    });
    await sellLine(org.id, store.id, {
      productVariantId: null,
      barcode: 'BC-RECREATED',
      quantity: 2,
      lineSaleGross: '80.00',
    });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '50.00',
        orderDate: todayAt(11).toISOString(),
        lines: [{ barcode: 'BC-RECREATED', quantity: 1, lineSaleGross: '50.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      variantId,
      barcode: 'BC-RECREATED',
      stockCode: 'SC-31',
      productName: 'Recreated Variant',
      orderCount: 2, // 1 order + 1 buffer entry
      unitsSold: 3, // 2 + 1
      revenue: '130.00', // 80 + 50
      unresolved: false,
      vendorMissing: false,
    });
  });

  it("merges an orphan line into a re-created variant's row without any buffer sale", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const deletedVariantId = await createVariant(org.id, store.id, {
      title: 'Deleted Variant',
      barcode: 'BC-REBORN',
      seq: 33,
    });
    await sellLine(org.id, store.id, {
      productVariantId: deletedVariantId,
      barcode: 'BC-REBORN',
      quantity: 2,
      lineSaleGross: '80.00',
    });
    // The item's variant FK is ON DELETE SET NULL: the line stays, variantless, with its barcode.
    await prisma.productVariant.delete({ where: { id: deletedVariantId } });

    // The re-created variant carries the same barcode and sells in another of today's orders.
    // No buffer entry: only the variantless line's own barcode can put it in the lookup.
    const recreatedVariantId = await createVariant(org.id, store.id, {
      title: 'Recreated Variant',
      barcode: 'BC-REBORN',
      seq: 34,
    });
    await sellLine(org.id, store.id, {
      productVariantId: recreatedVariantId,
      barcode: 'BC-REBORN',
      quantity: 3,
      lineSaleGross: '90.00',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      variantId: recreatedVariantId,
      barcode: 'BC-REBORN',
      unresolved: false,
      orderCount: 2, // 2 orders, no buffer entry
      unitsSold: 5, // 2 + 3
      revenue: '170.00', // 80 + 90
    });
  });

  it('merges a variantless order line and a buffer line of the same unknown barcode, with vendorMissing from CatalogBarcodeMiss', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await sellLine(org.id, store.id, {
      productVariantId: null,
      barcode: 'GAP-ORPHAN',
      quantity: 1,
      lineSaleGross: '40.00',
    });
    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: {
        saleGross: '90.00',
        orderDate: todayAt(11).toISOString(),
        lines: [{ barcode: 'GAP-ORPHAN', quantity: 2, lineSaleGross: '90.00' }],
      },
    });
    await prisma.catalogBarcodeMiss.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        barcode: 'GAP-ORPHAN',
        vendorMissing: true,
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      variantId: null,
      barcode: 'GAP-ORPHAN',
      orderCount: 2, // 1 order + 1 buffer entry
      unitsSold: 3, // 1 + 2
      revenue: '130.00', // 40 + 90
      costStatus: 'missing',
      unresolved: true,
      vendorMissing: true,
    });
  });

  it("does not resolve an orphan line through another organization's variant with the same barcode", async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    const orgB = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);

    // A variant row in store A stamped with organization B (the schema allows the
    // pair): only the lookup's organizationId filter keeps it out, not storeId.
    await createVariant(orgB.id, storeA.id, {
      title: 'Other Org Variant',
      barcode: 'BC-CROSS-ORG',
      seq: 32,
    });
    await sellLine(orgA.id, storeA.id, {
      productVariantId: null,
      barcode: 'BC-CROSS-ORG',
      quantity: 1,
      lineSaleGross: '25.00',
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      variantId: null,
      barcode: 'BC-CROSS-ORG',
      stockCode: null,
      productName: null,
      thumbUrl: null,
      unitsSold: 1,
      unresolved: true,
    });
  });

  it("a cancelled order's orphan line is absent", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await sellLine(org.id, store.id, {
      productVariantId: null,
      barcode: 'BC-ORPHAN-CANCEL',
      quantity: 5,
      lineSaleGross: '500.00',
      status: 'CANCELLED',
    });
    // A live orphan line of the same barcode, so the assertion is not met by an empty list.
    await sellLine(org.id, store.id, {
      productVariantId: null,
      barcode: 'BC-ORPHAN-CANCEL',
      quantity: 1,
      lineSaleGross: '20.00',
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/today-products`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body: TodayProductsBody = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      barcode: 'BC-ORPHAN-CANCEL',
      orderCount: 1,
      unitsSold: 1,
      revenue: '20.00',
    });
  });
});
