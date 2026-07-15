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

import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const IMAGE_URL = 'https://cdn.example/disc-1.jpg';

interface ScenarioWire {
  price: string;
  commissionPct: string | null;
  commissionSource: string | null;
  netProfit: string | null;
  marginPct: string | null;
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
  buyboxStatus: string | null;
  included: boolean;
  calculable: boolean;
  reason: string | null;
  current: ScenarioWire;
  discounted: ScenarioWire;
}
interface DetailWire {
  id: string;
  name: string;
  discountType: string;
  valueKind: string | null;
  value: string | null;
  minBasketAmount: string | null;
  exported: boolean;
  summary: {
    itemCount: number;
    selectedCount: number;
    perOrderCost: string;
    maxTotalCost: string | null;
    avgProfitDelta: string | null;
  };
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
  await prisma.productImage.create({
    data: { organizationId: org.id, productId: product.id, url: IMAGE_URL, position: 0 },
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
      buyboxStatus: 'Kazanan',
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

  it('returns the detail with config, summary and the computed current + discounted scenarios', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetailWire;
    expect(body.id).toBe(fx.listId);
    expect(body.discountType).toBe('NET');
    expect(body.valueKind).toBe('PERCENT');
    expect(body.value).toBe('15.00');
    expect(body.summary.itemCount).toBe(2);
    expect(body.summary.selectedCount).toBe(1);
    // Only the matched item is included: 250.00 − 212.50 (NET -15%) = 37.50.
    expect(body.summary.perOrderCost).toBe('37.50');
    // No orderLimit on the list → no max-total ceiling.
    expect(body.summary.maxTotalCost).toBeNull();
    // No included+calculable item → no average profit delta.
    expect(body.summary.avgProfitDelta).toBeNull();

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

    const unmatched = body.items.find((i) => i.id === fx.itemUnmatched);
    expect(unmatched?.imageUrl).toBeNull();
    expect(unmatched?.included).toBe(false);
  });

  it('full-replaces the config on PATCH and reflects it in the detail', async () => {
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
        }),
      },
    );
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { id: string }).id).toBe(fx.listId);

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

  it('rejects payQuantity 0 on BUY_X_PAY_Y (422 INVALID_PAY_QUANTITY)', async () => {
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
      body.errors.some((e) => e.field === 'payQuantity' && e.code === 'INVALID_PAY_QUANTITY'),
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

  it('deletes the list (204), then the detail 404s and the list is empty', async () => {
    const del = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/discount-lists/${fx.listId}`,
      { method: 'DELETE', headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(del.status).toBe(204);

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
