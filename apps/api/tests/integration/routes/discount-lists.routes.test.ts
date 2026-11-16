// Happy-path integration tests for the saved discount list endpoints
// (list / detail / config PATCH / delete).
//
// The detail computes each item's current + discounted scenarios on read (Görev 9). The
// seeded matched variant has no cost profile, no commission tariff, no synced commission
// and no category rate, so its three-tier chain resolves NOTHING — the item is not
// calculable with reason NO_COMMISSION (checked before cost). The discounted price still
// reflects the config (NET -15% ⇒ 250 → 212.50) and the summary aggregates the included
// items' per-order discount cost. These tests lock the config round-trip, the real
// scenario shape, the PATCH validator gate, and the delete cascade.

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { UPLOAD_NAME_MAX_LENGTH } from '@/config/workbook-limits';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const IMAGE_URL = 'https://cdn.example/disc-1.jpg';

// Both campaign dates are required on every config write (import + PATCH).
const CAMPAIGN_WINDOW = {
  startsAt: '2026-07-21T05:00:00.000Z',
  endsAt: '2026-07-28T04:59:00.000Z',
} as const;

// The whole body of a 422, field issues as sent (meta included), for a strict pin.
const RawValidationSchema = z.object({ code: z.string(), errors: z.array(z.unknown()) });

interface ScenarioWire {
  price: string;
  commissionPct: string | null;
  commissionSource: string | null;
  netProfit: string | null;
  marginPct: string | null;
}
interface BasketScenarioWire {
  assumedQuantity: number;
  basketTotal: string;
  basketPaidTotal: string;
  basketDiscountTotal: string;
  orderNetProfit: string | null;
  orderMarginPct: string | null;
  currentOrderNetProfit: string | null;
}
interface ItemWire {
  id: string;
  barcode: string;
  modelCode: string | null;
  externalId: string | null;
  productTitle: string;
  brand: string | null;
  color: string | null;
  imageUrl: string | null;
  included: boolean;
  calculable: boolean;
  reason: string | null;
  current: ScenarioWire;
  discounted: ScenarioWire;
  scenario: BasketScenarioWire | null;
}
interface DetailWire {
  id: string;
  name: string;
  discountType: string;
  valueKind: string | null;
  value: string | null;
  minBasketAmount: string | null;
  exported: boolean;
  scenarioPresentation: string;
  items: ItemWire[];
}
interface ListWire {
  data: {
    id: string;
    name: string;
    discountType: string;
    valueKind: string | null;
    value: string | null;
    itemCount: number;
    selectedCount: number;
    exported: boolean;
  }[];
}

interface Fixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  emptyStoreId: string;
  listId: string;
  itemMatched: string;
  itemUnmatched: string;
}

async function setupFixture(): Promise<Fixture> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  const emptyStore = await createStore(org.id);

  // One matched variant (with a primary image) so the detail's image batch-load surfaces
  // a non-null imageUrl; the second item stays unmatched to lock the null branch.
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 7201n,
      productMainId: 'pm-7201',
      title: 'İndirim Ürünü',
      categoryId: 597n,
      categoryName: 'Bayrak',
      brandId: 2032n,
      brandName: 'Alpaka',
      imageUrls: [IMAGE_URL],
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 72010n,
      barcode: 'DISC-1',
      stockCode: 'STK-DISC-1',
      salePrice: new Decimal('250.00'),
      listPrice: new Decimal('250.00'),
      vatRate: 20,
    },
  });

  const list = await prisma.discountList.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'İndirim Listesi',
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: new Decimal('15.00'),
      createdBy: user.id,
    },
  });
  const itemMatched = await prisma.discountListItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: variant.id,
      barcode: 'DISC-1',
      modelCode: 'MDL-1',
      externalId: 'EXT-1',
      productTitle: 'İndirim Ürünü',
      brand: 'Alpaka',
      color: 'Kırmızı',
      currentPrice: new Decimal('250.00'),
      included: true,
      sortOrder: 0,
    },
  });
  const itemUnmatched = await prisma.discountListItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: null,
      barcode: 'DISC-2',
      productTitle: 'Eşleşmeyen Ürün',
      currentPrice: new Decimal('99.90'),
      included: false,
      sortOrder: 1,
    },
  });

  // The detail computes profit on read, which resolves the loop-invariant fee
  // definitions — seed them so the compute path does not 500 on a missing STOPPAGE/PSF.
  await ensureFeeDefinitions();

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    emptyStoreId: emptyStore.id,
    listId: list.id,
    itemMatched: itemMatched.id,
    itemUnmatched: itemUnmatched.id,
  };
}

describe('Discount Lists - list / detail / config PATCH / delete', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  it('lists nothing for an empty store and the seeded list with config + counts', async () => {
    const empty = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.emptyStoreId}/discount-lists`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as ListWire).data).toHaveLength(0);

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListWire;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.id).toBe(fx.listId);
    expect(row?.name).toBe('İndirim Listesi');
    expect(row?.discountType).toBe('NET');
    expect(row?.valueKind).toBe('PERCENT');
    expect(row?.value).toBe('15.00');
    expect(row?.itemCount).toBe(2);
    expect(row?.selectedCount).toBe(1);
    expect(row?.exported).toBe(false);
  });

  it('returns the detail with config and the computed current + discounted scenarios (no summary)', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire & { summary?: unknown };
    expect(body.id).toBe(fx.listId);
    expect(body.discountType).toBe('NET');
    expect(body.valueKind).toBe('PERCENT');
    expect(body.value).toBe('15.00');
    // NET calls for the UNIT row layout (its showcase price genuinely drops).
    expect(body.scenarioPresentation).toBe('UNIT');
    // Selection is ephemeral client state now — the detail no longer carries a summary card.
    expect(body.summary).toBeUndefined();

    // Items come back in sortOrder.
    expect(body.items.map((i) => i.id)).toEqual([fx.itemMatched, fx.itemUnmatched]);

    const matched = body.items.find((i) => i.id === fx.itemMatched);
    expect(matched?.imageUrl).toBe(IMAGE_URL);
    expect(matched?.included).toBe(true);
    // No commission anywhere (no tariff / synced rate / category rate) → NO_COMMISSION,
    // resolved before the cost gate; profit fields stay null.
    expect(matched?.calculable).toBe(false);
    expect(matched?.reason).toBe('NO_COMMISSION');
    // The discounted price reflects the config even when the item is not calculable.
    expect(matched?.current.price).toBe('250.00');
    expect(matched?.discounted.price).toBe('212.50');
    expect(matched?.current.commissionPct).toBeNull();
    expect(matched?.current.commissionSource).toBeNull();
    expect(matched?.current.netProfit).toBeNull();
    expect(matched?.current.marginPct).toBeNull();
    expect(matched?.discounted.netProfit).toBeNull();
    // NET has no basket settlement scenario — its showcase price genuinely changes.
    expect(matched?.scenario).toBeNull();

    const unmatched = body.items.find((i) => i.id === fx.itemUnmatched);
    expect(unmatched?.imageUrl).toBeNull();
    expect(unmatched?.included).toBe(false);
    expect(unmatched?.scenario).toBeNull();
  });

  it('full-replaces the config on PATCH and reflects it in the detail', async () => {
    // The PATCH moves the list's updatedAt forward: start it at an old instant.
    const listScope = { id: fx.listId, organizationId: fx.orgId, storeId: fx.storeId };
    const oldUpdatedAt = new Date('2020-01-01T00:00:00.000Z');
    await prisma.discountList.updateMany({ where: listScope, data: { updatedAt: oldUpdatedAt } });
    const before = await prisma.discountList.findFirst({
      where: listScope,
      select: { updatedAt: true },
    });
    if (before?.updatedAt.getTime() !== oldUpdatedAt.getTime()) {
      throw new Error('the list did not start at the old updatedAt');
    }

    const patch = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Sepet İndirimi',
          discountType: 'CONDITIONAL_BASKET',
          valueKind: 'AMOUNT',
          value: '20',
          minBasketAmount: '150',
          ...CAMPAIGN_WINDOW,
        }),
      },
    );
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { id: string }).id).toBe(fx.listId);
    const after = await prisma.discountList.findFirst({
      where: listScope,
      select: { updatedAt: true },
    });
    expect(after?.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    const body = (await res.json()) as DetailWire;
    expect(body.name).toBe('Sepet İndirimi');
    expect(body.discountType).toBe('CONDITIONAL_BASKET');
    expect(body.valueKind).toBe('AMOUNT');
    expect(body.value).toBe('20.00');
    expect(body.minBasketAmount).toBe('150.00');

    // CONDITIONAL_BASKET AMOUNT calls for the ORDER row layout (the amount is split across the
    // basket, so the seller reasons about the whole order).
    expect(body.scenarioPresentation).toBe('ORDER');

    // CONDITIONAL_BASKET now carries the settlement scenario. currentPrice=250, minBasket=150 →
    // n = ceil(150/250) = 1; discounted unit = 250 − 20/1 = 230. The item is not calculable (no
    // commission chain resolves), so the three order-profit fields stay null.
    const matched = body.items.find((i) => i.id === fx.itemMatched);
    expect(matched?.scenario).toEqual({
      assumedQuantity: 1,
      basketTotal: '250.00',
      basketPaidTotal: '230.00',
      basketDiscountTotal: '20.00',
      orderNetProfit: null,
      orderMarginPct: null,
      currentOrderNetProfit: null,
    });
  });

  it('rejects an invalid config combination (422 FIXED_PRICE_ONLY_FOR_NTH)', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ discountType: 'NET', valueKind: 'FIXED_PRICE', value: '100' }),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'FIXED_PRICE_ONLY_FOR_NTH')).toBe(true);
  });

  it('rejects payQuantity 0 on BUY_X_PAY_Y (422 PAY_QUANTITY_TOO_SMALL)', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ discountType: 'BUY_X_PAY_Y', buyQuantity: '3', payQuantity: '0' }),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { field: string; code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(
      body.errors.some((e) => e.field === 'payQuantity' && e.code === 'PAY_QUANTITY_TOO_SMALL'),
    ).toBe(true);
  });

  it('rejects buyQuantity above 5 on BUY_X_PAY_Y (422 BUY_QUANTITY_OUT_OF_RANGE)', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ discountType: 'BUY_X_PAY_Y', buyQuantity: '6', payQuantity: '1' }),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { field: string; code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(
      body.errors.some((e) => e.field === 'buyQuantity' && e.code === 'BUY_QUANTITY_OUT_OF_RANGE'),
    ).toBe(true);
  });

  it('rejects an over-large value with a clean 422 VALUE_TOO_LARGE (no DB overflow 500)', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        // 12 integer digits — past the Decimal(12,2) ceiling of 10 integer digits.
        body: JSON.stringify({ discountType: 'NET', valueKind: 'AMOUNT', value: '100000000000' }),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: { field: string; code: string }[] };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.field === 'value' && e.code === 'VALUE_TOO_LARGE')).toBe(true);
  });

  it('rejects a name above 120 characters with 422 NAME_TOO_LONG and leaves the list as it was', async () => {
    const listScope = { id: fx.listId, organizationId: fx.orgId, storeId: fx.storeId };
    const select = { name: true, updatedAt: true } as const;
    const before = await prisma.discountList.findFirst({ where: listScope, select });
    if (before === null) throw new Error('the seeded list is gone');

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'n'.repeat(UPLOAD_NAME_MAX_LENGTH + 1),
          discountType: 'CONDITIONAL_BASKET',
          valueKind: 'AMOUNT',
          value: '20',
          minBasketAmount: '150',
          ...CAMPAIGN_WINDOW,
        }),
      },
    );

    expect(res.status).toBe(422);
    const body = RawValidationSchema.parse(await res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toStrictEqual([
      { field: 'name', code: 'NAME_TOO_LONG', meta: { zodCode: 'too_big' } },
    ]);
    expect(await prisma.discountList.findFirst({ where: listScope, select })).toEqual(before);
  });

  it('deletes the list (204), then the detail 404s and the list is empty', async () => {
    // The items go with the list: the database cascades the scoped delete.
    const itemCount = async (): Promise<number> =>
      prisma.discountListItem.count({ where: { listId: fx.listId } });
    expect(await itemCount()).toBeGreaterThan(0);

    const del = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      { method: 'DELETE', headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(del.status).toBe(204);
    expect(await itemCount()).toBe(0);

    const detail = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(detail.status).toBe(404);

    const list = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(((await list.json()) as ListWire).data).toHaveLength(0);
  });
});

describe('Discount Lists — per-item degrade (decision 9)', () => {
  // TWO items' scenarios are forced to throw (a negative currentPrice, which the engine's
  // unit-price validator rejects): the detail must still return 200 with those items' profit
  // empty (reason null) while a third item computes fine, and the failures must collapse into
  // exactly one [profit-read] line per request with failedCount 2.
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('keeps the discount detail up when items fail to compute and logs once', async () => {
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing — globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Discount Degrade Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'discount-degrade-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 7301n,
        productMainId: 'pm-7301',
        title: 'Bozulma Indirim Urunu',
        categoryId: 599n,
        categoryName: 'Kategori',
        brandId: null,
        brandName: null,
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: 73010n,
        barcode: 'DISC-DEG',
        stockCode: 'STK-DDEG',
        salePrice: new Decimal('500.00'),
        listPrice: new Decimal('500.00'),
        vatRate: 20,
        dimensionalWeightOverride: new Decimal('3.0'),
      },
    });
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'COGS Disc Degrade',
        type: 'COGS',
        amountGross: new Decimal('200.00'),
        vatRate: 20,
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: org.id,
        version: 1,
        name: 'COGS Disc Degrade',
        type: 'COGS',
        amountGross: new Decimal('200.00'),
        vatRate: 20,
        changedFields: [],
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
    });
    await ensureFeeDefinitions();
    // A CATEGORY commission rate so the chain resolves for the matched variant -> the healthy
    // item is calculable AND the failing items reach the engine (where the negative price throws).
    await prisma.marketplaceCommissionRate.create({
      data: {
        platform: 'TRENDYOL',
        ruleKind: 'CATEGORY',
        categoryId: 599n,
        brandId: null,
        categoryName: 'Kategori',
        parentCategoryName: 'Ust Kategori',
        brandName: null,
        baseRate: new Decimal('15'),
        paymentTermDays: 60,
        segmentOverrides: {},
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });

    const list = await prisma.discountList.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'Bozulma Indirim',
        discountType: 'NET',
        valueKind: 'PERCENT',
        value: new Decimal('10.00'),
        createdBy: user.id,
      },
    });
    const baseItem = {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: variant.id,
      barcode: 'DISC-DEG',
      productTitle: 'Bozulma Indirim Urunu',
    };
    // Healthy item: a positive current price -> computes.
    const okItem = await prisma.discountListItem.create({
      data: { ...baseItem, currentPrice: new Decimal('500.00'), included: true, sortOrder: 0 },
    });
    // Two failing items: a NEGATIVE current price makes the engine reject the unit price -> throw.
    const fail1 = await prisma.discountListItem.create({
      data: { ...baseItem, currentPrice: new Decimal('-5.00'), included: true, sortOrder: 1 },
    });
    const fail2 = await prisma.discountListItem.create({
      data: { ...baseItem, currentPrice: new Decimal('-7.00'), included: true, sortOrder: 2 },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/discount-lists/${list.id}`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );
      expect(res.status).toBe(200);
      const items = ((await res.json()) as DetailWire).items;

      const ok = items.find((i) => i.id === okItem.id);
      expect(ok?.calculable).toBe(true);
      expect(ok?.current.netProfit).not.toBeNull();

      for (const failId of [fail1.id, fail2.id]) {
        const bad = items.find((i) => i.id === failId);
        expect(bad?.calculable).toBe(false);
        // A degraded compute carries no reason (not NO_PRODUCT -- the variant is matched).
        expect(bad?.reason).toBeNull();
        expect(bad?.current.netProfit).toBeNull();
        expect(bad?.discounted.netProfit).toBeNull();
      }

      // Two failing items collapse into exactly one [profit-read] line, failedCount 2.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[profit-read] in-request profit computation failed',
        expect.objectContaining({
          surface: 'discount-list',
          orderId: null,
          failedCount: 2,
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
