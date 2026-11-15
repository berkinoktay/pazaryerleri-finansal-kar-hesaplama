// Happy-path integration tests for the Kampanyalar endpoints
// (import / list / detail / config PATCH / selections PATCH / delete).
//
// Two fixtures, deliberately:
//
//  1. The IMPORT describe drives the real anonymized Trendyol campaign sheet through the
//     route so the multipart form + config gate + persistence are proven end to end.
//  2. The CRUD describe seeds a two-item campaign by hand with prices chosen so every
//     number below can be verified with arithmetic: one matched, fully costable variant
//     (synced 18% commission → the product tier of the three-tier chain) and one unmatched
//     row. The campaign is 2-al-1-öde with a 60% Trendyol funding rate, which is what makes
//     the settlement block interesting — at funding 0 it would collapse to the İndirimler
//     numbers and prove nothing about this vertical.
//
// The three invariants this file exists to pin:
//   · the basket/order block is framed on the SAVED selection (MAX vs CUSTOM), not on
//     "does the item have a custom price";
//   · the config PATCH is a FULL REPLACE — omitting trendyolFundingPct resets it to 0;
//   · a custom price above the item's maximum is refused instead of persisted.

import { readFileSync } from 'node:fs';

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

const FIXTURE = readFileSync(
  new URL('../../fixtures/marketplace-campaign-sample.xlsx', import.meta.url),
);

// Facts of the vendor fixture (see tests/unit/services/marketplace-campaign-import.test.ts).
const FIXTURE_ROWS = 68;
const FIXTURE_MATCHED_BARCODE = '211537788423';

// Every campaign config write (import + PATCH) requires both dates.
const CAMPAIGN_WINDOW = {
  startsAt: '2026-07-21T05:00:00.000Z',
  endsAt: '2026-07-28T04:59:00.000Z',
} as const;

// The whole body of a 422, field issues as sent (meta included), for a strict pin.
const RawValidationSchema = z.object({ code: z.string(), errors: z.array(z.unknown()) });

const IMAGE_URL = 'https://cdn.example/campaign-1.jpg';

// Seeded campaign: 2 al 1 öde, %60 Trendyol funding.
const FUNDING_PCT = '60';
const PRODUCT_COMMISSION_PCT = 18;

// Matched item prices. current 250 is the no-campaign baseline; 200 is Trendyol's ceiling;
// 180 is the seller's own price. All three are far enough apart that a wrong framing is
// visible in the assertions rather than a rounding difference.
const CURRENT_PRICE = '250.00';
const MAX_PRICE = '200.00';
const CUSTOM_PRICE = '180.00';

interface ScenarioWire {
  price: string;
  commissionPct: string | null;
  commissionSource: 'band' | 'product' | 'category' | null;
  netProfit: string | null;
  marginPct: string | null;
}
interface BasketScenarioWire {
  assumedQuantity: number;
  basketTotal: string;
  basketPaidTotal: string;
  basketDiscountTotal: string;
  trendyolFundedTotal: string;
  orderNetProfit: string | null;
  orderMarginPct: string | null;
  currentOrderNetProfit: string | null;
}
interface ItemWire {
  id: string;
  barcode: string;
  productTitle: string;
  imageUrl: string | null;
  currentPrice: string;
  maxPrice: string;
  hasCommissionTariff: boolean;
  selection: 'NONE' | 'MAX' | 'CUSTOM';
  customPrice: string | null;
  calculable: boolean;
  reason: string | null;
  current: ScenarioWire;
  maxScenario: ScenarioWire;
  customScenario: ScenarioWire | null;
  commissionBands: unknown[] | null;
  maxBasket: BasketScenarioWire | null;
  customBasket: BasketScenarioWire | null;
}
interface DetailWire {
  id: string;
  name: string;
  discountType: string;
  valueKind: string | null;
  value: string | null;
  minBasketAmount: string | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  trendyolFundingPct: string;
  exported: boolean;
  commissionTariffName: string | null;
  commissionTariffOutdated: boolean;
  scenarioPresentation: 'UNIT' | 'ORDER';
  items: ItemWire[];
}
interface ListWire {
  data: {
    id: string;
    name: string;
    discountType: string;
    buyQuantity: number | null;
    payQuantity: number | null;
    trendyolFundingPct: string;
    itemCount: number;
    selectedCount: number;
    exported: boolean;
  }[];
}
interface ImportWire {
  campaignId: string;
  name: string;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}
interface ProblemWire {
  code: string;
  errors?: { field: string; code: string }[];
}

// ─── Import ───────────────────────────────────────────────────────────────────

describe('POST .../marketplace-campaigns/import', () => {
  let accessToken: string;
  let orgId: string;
  let storeId: string;
  let imported: ImportWire;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    accessToken = user.accessToken;
    orgId = org.id;
    storeId = store.id;

    // One catalog variant so exactly one sheet row matches.
    const product = await prisma.product.create({
      data: {
        organizationId: orgId,
        storeId,
        platformContentId: 8801n,
        productMainId: 'pm-8801',
        title: 'Kampanya Ürünü',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgId,
        storeId,
        productId: product.id,
        platformVariantId: 88010n,
        barcode: FIXTURE_MATCHED_BARCODE,
        stockCode: 'STK-CAMP-IMPORT',
        salePrice: new Decimal('249.00'),
        listPrice: new Decimal('249.00'),
        vatRate: 20,
      },
    });

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(FIXTURE)]), 'trendyol_kampanya.xlsx');
    form.append('discountType', 'CONDITIONAL_QUANTITY');
    form.append('valueKind', 'PERCENT');
    form.append('value', '10');
    form.append('minQuantity', '2');
    form.append('trendyolFundingPct', '40');
    form.append('startsAt', CAMPAIGN_WINDOW.startsAt);
    form.append('endsAt', CAMPAIGN_WINDOW.endsAt);

    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${orgId}/stores/${storeId}/marketplace-campaigns/import`,
        { method: 'POST', headers: { Authorization: bearer(accessToken) }, body: form },
      ),
    );
    expect(res.status).toBe(201);
    imported = (await res.json()) as ImportWire;
  });

  it('imports every product row and matches only the catalog barcode', () => {
    expect(imported.itemCount).toBe(FIXTURE_ROWS);
    expect(imported.matched).toBe(1);
    expect(imported.unmatched).toBe(FIXTURE_ROWS - 1);
    expect(imported.skippedRows).toBe(0);
    expect(imported.name).not.toBe('');
  });

  it('persists the campaign config, the funding rate and the raw source file', async () => {
    const list = await prisma.marketplaceCampaignList.findUnique({
      where: { id: imported.campaignId },
      select: {
        storeId: true,
        sourceFile: true,
        discountType: true,
        valueKind: true,
        value: true,
        minQuantity: true,
        trendyolFundingPct: true,
      },
    });
    expect(list?.storeId).toBe(storeId);
    expect(list?.sourceFile).not.toBeNull();
    expect(list?.discountType).toBe('CONDITIONAL_QUANTITY');
    expect(list?.valueKind).toBe('PERCENT');
    expect(Number(list?.value)).toBe(10);
    expect(list?.minQuantity).toBe(2);
    expect(Number(list?.trendyolFundingPct)).toBe(40);
  });

  it('starts every item at NONE — the seller has made no price choice yet', async () => {
    const chosen = await prisma.marketplaceCampaignItem.count({
      where: { listId: imported.campaignId, selection: { not: 'NONE' } },
    });
    expect(chosen).toBe(0);

    const res = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/marketplace-campaigns`,
      { headers: { Authorization: bearer(accessToken) } },
    );
    const body = (await res.json()) as ListWire;
    expect(body.data[0]?.itemCount).toBe(FIXTURE_ROWS);
    expect(body.data[0]?.selectedCount).toBe(0);
  });

  it('rejects a funding rate above 100 with 422 FUNDING_PCT_OVER_100', async () => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(FIXTURE)]), 'trendyol_kampanya.xlsx');
    form.append('discountType', 'NET');
    form.append('valueKind', 'PERCENT');
    form.append('value', '10');
    form.append('trendyolFundingPct', '120');
    form.append('startsAt', CAMPAIGN_WINDOW.startsAt);
    form.append('endsAt', CAMPAIGN_WINDOW.endsAt);

    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${orgId}/stores/${storeId}/marketplace-campaigns/import`,
        { method: 'POST', headers: { Authorization: bearer(accessToken) }, body: form },
      ),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'trendyolFundingPct', code: 'FUNDING_PCT_OVER_100' }),
      ]),
    );
  });
});

// ─── List / detail / config PATCH / selections / delete ───────────────────────

interface Fixture {
  accessToken: string;
  orgId: string;
  storeId: string;
  emptyStoreId: string;
  campaignId: string;
  matchedItemId: string;
  unmatchedItemId: string;
}

async function setupFixture(): Promise<Fixture> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) {
    throw new Error('SENDEOMP carrier missing - globalSetup ensureShippingReferenceData must run');
  }

  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Campaign Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'marketplace-campaign-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });
  const emptyStore = await createStore(org.id);

  await ensureFeeDefinitions();

  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('60.00'),
      vatRate: 20,
    },
  });
  // The scenario engine costs from the profile's VERSIONS (effective-dated), exactly as the
  // real cost-profile service writes a version 1 on create. Without it the matched variant
  // would read MISSING_COST and the campaign scenarios would be uncalculable.
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: org.id,
      version: 1,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('60.00'),
      vatRate: 20,
      changedFields: [],
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });

  // Matched, fully costable variant. `syncedCommissionRate` puts the item on the PRODUCT
  // tier of the three-tier chain — no commission tariff is uploaded in this fixture, so the
  // band tier resolves nothing and the category tier is never reached.
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 7301n,
      productMainId: 'pm-7301',
      title: 'Kampanya Ürünü',
      categoryId: 597n,
      categoryName: 'Bayrak',
      imageUrls: [IMAGE_URL],
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 73010n,
      barcode: 'CAMP-1',
      stockCode: 'STK-CAMP-1',
      salePrice: new Decimal(CURRENT_PRICE),
      listPrice: new Decimal(CURRENT_PRICE),
      vatRate: 20,
      dimensionalWeightOverride: new Decimal('3.0'),
      syncedCommissionRate: new Decimal(PRODUCT_COMMISSION_PCT),
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId: org.id, profileId: profile.id, productVariantId: variant.id },
  });

  const list = await prisma.marketplaceCampaignList.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'Yaz Kampanyası',
      discountType: 'BUY_X_PAY_Y',
      buyQuantity: 2,
      payQuantity: 1,
      trendyolFundingPct: new Decimal(FUNDING_PCT),
      startsAt: new Date('2026-07-21T05:00:00.000Z'),
      endsAt: new Date('2026-07-28T04:59:00.000Z'),
      createdBy: user.id,
    },
  });

  const matched = await prisma.marketplaceCampaignItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: variant.id,
      barcode: 'CAMP-1',
      productTitle: 'Kampanya Ürünü',
      productCode: 'PC-1',
      externalId: 'EXT-1',
      brand: 'Alpaka',
      color: 'Kırmızı',
      size: 'Tek Ebat',
      category: 'Bayrak',
      stock: 100,
      currentPrice: new Decimal(CURRENT_PRICE),
      maxPrice: new Decimal(MAX_PRICE),
      hasCommissionTariff: false,
      // The seller typed a custom price but is still participating at the MAXIMUM — each
      // option must still carry its own basket block.
      selection: 'MAX',
      customPrice: new Decimal(CUSTOM_PRICE),
      sortOrder: 0,
    },
  });
  const unmatched = await prisma.marketplaceCampaignItem.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: null,
      barcode: 'CAMP-2',
      productTitle: 'Eşleşmeyen Ürün',
      currentPrice: new Decimal('99.90'),
      maxPrice: new Decimal('80.00'),
      selection: 'NONE',
      sortOrder: 1,
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    emptyStoreId: emptyStore.id,
    campaignId: list.id,
    matchedItemId: matched.id,
    unmatchedItemId: unmatched.id,
  };
}

describe('Marketplace Campaigns - list / detail / config PATCH / selections / delete', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  async function fetchDetail(): Promise<DetailWire> {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${fx.campaignId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    return (await res.json()) as DetailWire;
  }

  async function patchSelections(body: unknown): Promise<Response> {
    return app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${fx.campaignId}/selections`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  it('lists nothing for an empty store and the seeded campaign with config + counts', async () => {
    const empty = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.emptyStoreId}/marketplace-campaigns`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as ListWire).data).toHaveLength(0);

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListWire;
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row?.id).toBe(fx.campaignId);
    expect(row?.name).toBe('Yaz Kampanyası');
    expect(row?.discountType).toBe('BUY_X_PAY_Y');
    expect(row?.buyQuantity).toBe(2);
    expect(row?.payQuantity).toBe(1);
    expect(row?.trendyolFundingPct).toBe('60.00');
    expect(row?.itemCount).toBe(2);
    // Only the matched item carries a price choice (MAX); the unmatched one is still NONE.
    expect(row?.selectedCount).toBe(1);
    expect(row?.exported).toBe(false);
  });

  it('returns the detail with the three price scenarios and the funded basket block', async () => {
    const body = await fetchDetail();
    expect(body.id).toBe(fx.campaignId);
    expect(body.discountType).toBe('BUY_X_PAY_Y');
    expect(body.trendyolFundingPct).toBe('60.00');
    // 2 al 1 öde is an ORDER-presentation config: the effective unit is a synthetic average.
    expect(body.scenarioPresentation).toBe('ORDER');
    // No commission tariff is uploaded for this store, so there is nothing to be outdated.
    expect(body.commissionTariffName).toBeNull();
    expect(body.commissionTariffOutdated).toBe(false);

    // Items come back in sortOrder.
    expect(body.items.map((i) => i.id)).toEqual([fx.matchedItemId, fx.unmatchedItemId]);

    const matched = body.items.find((i) => i.id === fx.matchedItemId);
    expect(matched?.imageUrl).toBe(IMAGE_URL);
    expect(matched?.currentPrice).toBe(CURRENT_PRICE);
    expect(matched?.maxPrice).toBe(MAX_PRICE);
    expect(matched?.selection).toBe('MAX');
    expect(matched?.customPrice).toBe(CUSTOM_PRICE);
    expect(matched?.calculable).toBe(true);
    expect(matched?.reason).toBeNull();
    // No tariff bands anywhere → the chain falls to the variant's synced rate.
    expect(matched?.commissionBands).toBeNull();
    expect(matched?.current.commissionSource).toBe('product');
    expect(matched?.current.commissionPct).toBe('18.0000');

    // current = the campaign-free baseline, priced at the current price.
    expect(matched?.current.price).toBe(CURRENT_PRICE);
    expect(matched?.current.netProfit).not.toBeNull();
    // maxScenario / customScenario are priced at the SELLER's settlement amount:
    //   2 al 1 öde → effective unit = P/2, discount = P/2, Trendyol funds 60% of it,
    //   so the seller settles at P − 0.4 × P/2 = 0.8 × P.
    //   max:    0.8 × 200 = 160.00      custom: 0.8 × 180 = 144.00
    expect(matched?.maxScenario.price).toBe('160.00');
    expect(matched?.customScenario?.price).toBe('144.00');
    expect(matched?.maxScenario.netProfit).not.toBeNull();
    expect(matched?.customScenario?.netProfit).not.toBeNull();
    // Selling at a lower price cannot earn more than the campaign-free baseline.
    expect(Number(matched?.maxScenario.netProfit)).toBeLessThan(Number(matched?.current.netProfit));
    expect(Number(matched?.customScenario?.netProfit)).toBeLessThan(
      Number(matched?.maxScenario.netProfit),
    );

    // Each price option carries its OWN settlement block. The maximum (campaign price 200):
    //   n = buyQuantity = 2 · basket 2 × 200 = 400 · customer pays 2 × 100 = 200
    //   discount 200 · seller settles 2 × 160 = 320 → Trendyol funds 320 − 200 = 120.
    expect(matched?.maxBasket?.assumedQuantity).toBe(2);
    expect(matched?.maxBasket?.basketTotal).toBe('400.00');
    expect(matched?.maxBasket?.basketPaidTotal).toBe('200.00');
    expect(matched?.maxBasket?.basketDiscountTotal).toBe('200.00');
    expect(matched?.maxBasket?.trendyolFundedTotal).toBe('120.00');
    expect(matched?.maxBasket?.orderNetProfit).not.toBeNull();
    expect(matched?.maxBasket?.orderMarginPct).not.toBeNull();
    expect(matched?.maxBasket?.currentOrderNetProfit).not.toBeNull();
    // The saved custom price (180) has its block too, although MAX is the selection:
    //   basket 2 × 180 = 360 · customer pays 2 × 90 = 180 · seller 2 × 144 = 288 → funds 108.
    expect(matched?.customBasket?.assumedQuantity).toBe(2);
    expect(matched?.customBasket?.basketTotal).toBe('360.00');
    expect(matched?.customBasket?.basketPaidTotal).toBe('180.00');
    expect(matched?.customBasket?.trendyolFundedTotal).toBe('108.00');
    // Same n units campaign-free → the same baseline on both blocks.
    expect(matched?.customBasket?.currentOrderNetProfit).toBe(
      matched?.maxBasket?.currentOrderNetProfit,
    );

    const unmatched = body.items.find((i) => i.id === fx.unmatchedItemId);
    expect(unmatched?.imageUrl).toBeNull();
    expect(unmatched?.calculable).toBe(false);
    expect(unmatched?.reason).toBe('NO_PRODUCT');
    expect(unmatched?.customScenario).toBeNull();
    // No selection yet: the maximum price's block is there all the same; with no custom
    // price there is no custom block.
    expect(unmatched?.maxBasket?.basketTotal).toBe('160.00');
    expect(unmatched?.maxBasket?.basketPaidTotal).toBe('80.00');
    expect(unmatched?.maxBasket?.trendyolFundedTotal).toBe('48.00');
    expect(unmatched?.maxBasket?.orderNetProfit).toBeNull();
    expect(unmatched?.customBasket).toBeNull();
  });

  it('keeps each option on its own basket block when the seller switches to CUSTOM', async () => {
    const res = await patchSelections({
      mode: 'set',
      selections: [{ itemId: fx.matchedItemId, selection: 'CUSTOM', customPrice: CUSTOM_PRICE }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(1);

    const body = await fetchDetail();
    const matched = body.items.find((i) => i.id === fx.matchedItemId);
    expect(matched?.selection).toBe('CUSTOM');
    // Same item, same custom price as before — only the SELECTION changed, and it moves
    // neither block: the custom card still shows 2 × 180 = 360 (customer 180, Trendyol 108)
    // and the maximum card its own 400 order.
    expect(matched?.customBasket?.basketTotal).toBe('360.00');
    expect(matched?.customBasket?.basketPaidTotal).toBe('180.00');
    expect(matched?.customBasket?.basketDiscountTotal).toBe('180.00');
    expect(matched?.customBasket?.trendyolFundedTotal).toBe('108.00');
    expect(matched?.maxBasket?.basketTotal).toBe('400.00');
  });

  it('rejects a custom price above the item maximum with 422 CUSTOM_PRICE_ABOVE_MAX', async () => {
    const res = await patchSelections({
      mode: 'set',
      selections: [{ itemId: fx.matchedItemId, selection: 'CUSTOM', customPrice: '250.00' }],
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'selections', code: 'CUSTOM_PRICE_ABOVE_MAX' }),
      ]),
    );

    // Nothing was written — the earlier custom price survives untouched.
    const item = await prisma.marketplaceCampaignItem.findUnique({
      where: { id: fx.matchedItemId },
      select: { selection: true, customPrice: true },
    });
    expect(item?.selection).toBe('CUSTOM');
    expect(item?.customPrice?.toFixed(2)).toBe(CUSTOM_PRICE);
  });

  it('rejects a CUSTOM selection with no price with 422 CUSTOM_PRICE_REQUIRED', async () => {
    // The silent twin of CUSTOM_PRICE_ABOVE_MAX: without this gate the row persists as
    // "participating" with an empty price, the exported sheet's price cell comes out blank
    // and Trendyol simply skips the product — with no error the seller could ever see.
    const res = await patchSelections({
      mode: 'set',
      selections: [{ itemId: fx.matchedItemId, selection: 'CUSTOM', customPrice: null }],
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'selections',
          code: 'CUSTOM_PRICE_REQUIRED',
          // Named so the frontend can highlight the offending row, exactly as the ceiling
          // guard does.
          meta: expect.objectContaining({ itemId: fx.matchedItemId }),
        }),
      ]),
    );

    // Nothing was written — the price the seller typed earlier survives untouched.
    const item = await prisma.marketplaceCampaignItem.findUnique({
      where: { id: fx.matchedItemId },
      select: { selection: true, customPrice: true },
    });
    expect(item?.selection).toBe('CUSTOM');
    expect(item?.customPrice?.toFixed(2)).toBe(CUSTOM_PRICE);
  });

  it("mode 'all' selects every item at MAX and 'none' clears them, both keeping custom prices", async () => {
    const all = await patchSelections({ mode: 'all' });
    expect(all.status).toBe(200);
    expect(((await all.json()) as { updated: number }).updated).toBe(2);

    const afterAll = await fetchDetail();
    expect(afterAll.items.map((i) => i.selection)).toEqual(['MAX', 'MAX']);
    // The typed price is stored independently of the choice — 'all' must not discard it.
    expect(afterAll.items.find((i) => i.id === fx.matchedItemId)?.customPrice).toBe(CUSTOM_PRICE);

    const none = await patchSelections({ mode: 'none' });
    expect(none.status).toBe(200);
    expect(((await none.json()) as { updated: number }).updated).toBe(2);

    const afterNone = await fetchDetail();
    expect(afterNone.items.map((i) => i.selection)).toEqual(['NONE', 'NONE']);
    expect(afterNone.items.find((i) => i.id === fx.matchedItemId)?.customPrice).toBe(CUSTOM_PRICE);

    const list = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(((await list.json()) as ListWire).data[0]?.selectedCount).toBe(0);
  });

  it('FULL-REPLACES the config on PATCH — an omitted funding rate is reset to zero', async () => {
    // The PATCH moves the campaign's updatedAt forward: start it at an old instant.
    const campaignScope = { id: fx.campaignId, organizationId: fx.orgId, storeId: fx.storeId };
    const oldUpdatedAt = new Date('2020-01-01T00:00:00.000Z');
    await prisma.marketplaceCampaignList.updateMany({
      where: campaignScope,
      data: { updatedAt: oldUpdatedAt },
    });
    const before = await prisma.marketplaceCampaignList.findFirst({
      where: campaignScope,
      select: { updatedAt: true },
    });
    if (before?.updatedAt.getTime() !== oldUpdatedAt.getTime()) {
      throw new Error('the campaign did not start at the old updatedAt');
    }

    const patch = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${fx.campaignId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        // trendyolFundingPct deliberately OMITTED: the schema defaults it to '0', so this
        // PATCH zeroes the seller's 60% funding rate. Documented contract, not an accident —
        // the edit dialog must always submit the whole configuration.
        body: JSON.stringify({
          name: 'Sepet Kampanyası',
          discountType: 'CONDITIONAL_BASKET',
          valueKind: 'PERCENT',
          value: '10',
          minBasketAmount: '500',
          ...CAMPAIGN_WINDOW,
        }),
      },
    );
    expect(patch.status).toBe(200);
    expect(((await patch.json()) as { id: string }).id).toBe(fx.campaignId);
    const after = await prisma.marketplaceCampaignList.findFirst({
      where: campaignScope,
      select: { updatedAt: true },
    });
    expect(after?.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());

    const body = await fetchDetail();
    expect(body.name).toBe('Sepet Kampanyası');
    expect(body.discountType).toBe('CONDITIONAL_BASKET');
    expect(body.valueKind).toBe('PERCENT');
    expect(body.value).toBe('10.00');
    expect(body.minBasketAmount).toBe('500.00');
    // The per-type parameters of the OLD config are cleared, not carried over.
    expect(body.buyQuantity).toBeNull();
    expect(body.payQuantity).toBeNull();
    // The funding rate is gone.
    expect(body.trendyolFundingPct).toBe('0.00');
    // A percent basket discount really does lower every unit → UNIT row layout.
    expect(body.scenarioPresentation).toBe('UNIT');

    const matched = body.items.find((i) => i.id === fx.matchedItemId);
    // The maximum price's block (200) under the new config:
    //   n = ceil(500 / 200) = 3 · basket 3 × 200 = 600 · unit −10% = 180 → paid 3 × 180 = 540.
    //   At funding 0 the seller settles exactly what the customer paid.
    expect(matched?.maxBasket?.assumedQuantity).toBe(3);
    expect(matched?.maxBasket?.basketTotal).toBe('600.00');
    expect(matched?.maxBasket?.basketPaidTotal).toBe('540.00');
    expect(matched?.maxBasket?.basketDiscountTotal).toBe('60.00');
    expect(matched?.maxBasket?.trendyolFundedTotal).toBe('0.00');
    // And the unit scenario is the plain discounted unit again — no funding uplift.
    expect(matched?.maxScenario.price).toBe('180.00');
  });

  it('rejects an invalid config combination (422 FIXED_PRICE_ONLY_FOR_NTH)', async () => {
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${fx.campaignId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discountType: 'NET',
          valueKind: 'FIXED_PRICE',
          value: '100',
          ...CAMPAIGN_WINDOW,
        }),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.some((e) => e.code === 'FIXED_PRICE_ONLY_FOR_NTH')).toBe(true);
  });

  it('rejects a name above 120 characters with 422 NAME_TOO_LONG and leaves the campaign as it was', async () => {
    const campaignScope = { id: fx.campaignId, organizationId: fx.orgId, storeId: fx.storeId };
    const select = { name: true, updatedAt: true } as const;
    const before = await prisma.marketplaceCampaignList.findFirst({ where: campaignScope, select });
    if (before === null) throw new Error('the seeded campaign is gone');

    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${fx.campaignId}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'n'.repeat(UPLOAD_NAME_MAX_LENGTH + 1),
          discountType: 'CONDITIONAL_BASKET',
          valueKind: 'PERCENT',
          value: '10',
          minBasketAmount: '500',
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
    expect(
      await prisma.marketplaceCampaignList.findFirst({ where: campaignScope, select }),
    ).toEqual(before);
  });

  it('deletes the campaign (204), then the detail 404s and the list is empty', async () => {
    const del = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${fx.campaignId}`,
      { method: 'DELETE', headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(del.status).toBe(204);

    const detail = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${fx.campaignId}`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(detail.status).toBe(404);

    const list = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns`,
      { headers: { Authorization: bearer(fx.accessToken) } },
    );
    expect(((await list.json()) as ListWire).data).toHaveLength(0);

    // Items cascaded with the parent.
    const items = await prisma.marketplaceCampaignItem.count({
      where: { listId: fx.campaignId },
    });
    expect(items).toBe(0);
  });
});

// ─── Per-item degrade (decision 9) ──────────────────────────────────────────────

describe('Marketplace Campaigns — per-item degrade (decision 9)', () => {
  // TWO items' scenarios are forced to throw (a negative currentPrice, which the engine's
  // unit-price validator rejects): the detail must still return 200 with those items' profit
  // empty (reason null) while a third item computes fine, and the failures must collapse into
  // exactly one [profit-read] line per request with failedCount 2.
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('keeps the campaign detail up when items fail to compute and logs once', async () => {
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing — globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Campaign Degrade Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'marketplace-campaign-degrade-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 7701n,
        productMainId: 'pm-7701',
        title: 'Bozulma Kampanya Urunu',
        categoryId: 599n,
        categoryName: 'Kategori',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: 77010n,
        barcode: 'CAMP-DEG',
        stockCode: 'STK-CDEG',
        salePrice: new Decimal('250.00'),
        listPrice: new Decimal('250.00'),
        vatRate: 20,
        dimensionalWeightOverride: new Decimal('3.0'),
      },
    });
    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'COGS Camp Degrade',
        type: 'COGS',
        amountGross: new Decimal('60.00'),
        vatRate: 20,
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: org.id,
        version: 1,
        name: 'COGS Camp Degrade',
        type: 'COGS',
        amountGross: new Decimal('60.00'),
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

    const list = await prisma.marketplaceCampaignList.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'Bozulma Kampanyasi',
        discountType: 'NET',
        valueKind: 'PERCENT',
        value: new Decimal('10.00'),
        trendyolFundingPct: new Decimal('0'),
        createdBy: user.id,
      },
    });
    const baseItem = {
      organizationId: org.id,
      storeId: store.id,
      listId: list.id,
      productVariantId: variant.id,
      barcode: 'CAMP-DEG',
      productTitle: 'Bozulma Kampanya Urunu',
      maxPrice: new Decimal('200.00'),
    };
    // Healthy item: a positive current price -> computes.
    const okItem = await prisma.marketplaceCampaignItem.create({
      data: { ...baseItem, currentPrice: new Decimal('250.00'), selection: 'NONE', sortOrder: 0 },
    });
    // Two failing items: a NEGATIVE current price makes the engine reject the unit price -> throw.
    const fail1 = await prisma.marketplaceCampaignItem.create({
      data: { ...baseItem, currentPrice: new Decimal('-5.00'), selection: 'NONE', sortOrder: 1 },
    });
    const fail2 = await prisma.marketplaceCampaignItem.create({
      data: { ...baseItem, currentPrice: new Decimal('-7.00'), selection: 'NONE', sortOrder: 2 },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${store.id}/marketplace-campaigns/${list.id}`,
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
        expect(bad?.maxScenario.netProfit).toBeNull();
      }

      // Two failing items collapse into exactly one [profit-read] line, failedCount 2.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        '[profit-read] in-request profit computation failed',
        expect.objectContaining({
          surface: 'marketplace-campaign',
          orderId: null,
          failedCount: 2,
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
