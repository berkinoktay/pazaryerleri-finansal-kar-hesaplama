// Integration tests for the two read-only Kampanyalar compute endpoints:
//
//   POST .../marketplace-campaigns/{campaignId}/items/{itemId}/estimate
//   POST .../marketplace-campaigns/{campaignId}/target-margin
//
// The fixture is deliberately the same arithmetic shape the detail test uses (2 al 1 öde,
// 60% Trendyol funding, one matched fully-costable variant on the PRODUCT commission tier and
// one unmatched row) so every number below can be checked by hand rather than snapshotted.
//
// What this file exists to pin:
//   · the modal never disagrees with the row it was opened from — an ORDER-presentation
//     campaign returns an ORDER breakdown for EVERY scenario, `current` included, and that
//     order's profit equals the row's currentOrderNetProfit;
//   · the Trendyol-funded split is visible per unit even for a UNIT-presentation campaign
//     (Net %X), where there is no basket block to carry it;
//   · the ceiling and the missing-price gates both refuse instead of pricing;
//   · target-margin COMPUTES ONLY — selection and customPrice are byte-identical afterwards;
//   · a cross-org campaign/item id is a 404, not a 403.

import { randomUUID } from 'node:crypto';

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

const FUNDING_PCT = '60';
const PRODUCT_COMMISSION_PCT = 18;

// 900 is the campaign-free baseline, 800 Trendyol's ceiling, 600 the seller's own price.
// Deliberately far above the per-parcel shipping tariff: a 2 al 1 öde halves the unit
// revenue, and at a low price point the UNIT economics go negative — which would make every
// target margin trivially unreachable and prove nothing about the solver.
const CURRENT_PRICE = '900.00';
const MAX_PRICE = '800.00';
const CUSTOM_PRICE = '600.00';

interface BreakdownWire {
  saleGross: string;
  netProfit: string;
  costGross: string;
  shippingGross: string;
  platformServiceGross: string;
}
interface BasketWire {
  assumedQuantity: number;
  basketTotal: string;
  basketPaidTotal: string;
  trendyolFundedTotal: string;
  orderNetProfit: string | null;
  currentOrderNetProfit: string | null;
}
interface EstimateWire {
  itemId: string;
  scenario: 'current' | 'max' | 'custom';
  price: string;
  customerPaidUnitPrice: string | null;
  trendyolFundedUnitAmount: string | null;
  commissionPct: string | null;
  commissionSource: 'band' | 'product' | 'category' | null;
  calculable: boolean;
  reason: string | null;
  breakdown: BreakdownWire | null;
  breakdownScope: 'unit' | 'order';
  basket: BasketWire | null;
  commissionTariffName: string | null;
  commissionPeriodLabel: string | null;
}
interface TargetMarginWire {
  suggestions: {
    itemId: string;
    price: string | null;
    reason: 'UNREACHABLE' | 'NOT_CALCULABLE' | null;
  }[];
}
interface DetailItemWire {
  id: string;
  current: { netProfit: string | null };
  maxScenario: { marginPct: string | null };
  maxBasket: BasketWire | null;
  customBasket: BasketWire | null;
}
interface ProblemWire {
  code: string;
  errors?: { field: string; code: string; meta?: Record<string, unknown> }[];
}

interface Fixture {
  accessToken: string;
  orgId: string;
  storeId: string;
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
      name: 'Campaign Estimate Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'marketplace-campaign-estimate-test',
      credentials: 'opaque',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier.id,
    },
  });

  await ensureFeeDefinitions();

  const profile = await prisma.costProfile.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('20.00'),
      vatRate: 20,
    },
  });
  // The scenario engine costs from the profile's VERSIONS (effective-dated), exactly as the
  // real cost-profile service writes a version 1 on create. Without it the matched variant
  // would read MISSING_COST and every estimate below would be uncalculable.
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: org.id,
      version: 1,
      name: 'COGS Test',
      type: 'COGS',
      amountGross: new Decimal('20.00'),
      vatRate: 20,
      changedFields: [],
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 7401n,
      productMainId: 'pm-7401',
      title: 'Kampanya Ürünü',
      categoryId: 597n,
      categoryName: 'Bayrak',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 74010n,
      barcode: 'CAMP-EST-1',
      stockCode: 'STK-CAMP-EST-1',
      salePrice: new Decimal(CURRENT_PRICE),
      listPrice: new Decimal(CURRENT_PRICE),
      vatRate: 20,
      dimensionalWeightOverride: new Decimal('1.0'),
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
      barcode: 'CAMP-EST-1',
      productTitle: 'Kampanya Ürünü',
      stock: 100,
      currentPrice: new Decimal(CURRENT_PRICE),
      maxPrice: new Decimal(MAX_PRICE),
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
      barcode: 'CAMP-EST-2',
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
    campaignId: list.id,
    matchedItemId: matched.id,
    unmatchedItemId: unmatched.id,
  };
}

describe('Marketplace Campaigns - estimate + target-margin', () => {
  let fx: Fixture;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    fx = await setupFixture();
  });

  const base = (): string =>
    `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${fx.campaignId}`;

  async function estimate(itemId: string, body: unknown): Promise<Response> {
    return app.request(`${base()}/items/${itemId}/estimate`, {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function targetMargin(body: unknown): Promise<Response> {
    return app.request(`${base()}/target-margin`, {
      method: 'POST',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function estimateJson(itemId: string, body: unknown): Promise<EstimateWire> {
    const res = await estimate(itemId, body);
    expect(res.status).toBe(200);
    return (await res.json()) as EstimateWire;
  }

  async function patchSelections(body: unknown): Promise<Response> {
    return app.request(`${base()}/selections`, {
      method: 'PATCH',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function updateCampaign(body: Record<string, unknown>): Promise<Response> {
    return app.request(base(), {
      method: 'PATCH',
      headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startsAt: '2026-07-21T05:00:00.000Z',
        endsAt: '2026-07-28T04:59:00.000Z',
        ...body,
      }),
    });
  }

  // ─── Scope + funding split ──────────────────────────────────────────────────

  it('prices the max scenario as the whole ORDER, with no per-unit split alongside it', async () => {
    const body = await estimateJson(fx.matchedItemId, { scenario: 'max' });

    expect(body.itemId).toBe(fx.matchedItemId);
    expect(body.calculable).toBe(true);
    expect(body.reason).toBeNull();
    // No commission tariff is uploaded → the chain falls to the variant's synced rate.
    expect(body.commissionSource).toBe('product');
    expect(body.commissionPct).toBe('18.0000');
    expect(body.commissionTariffName).toBeNull();

    // 2 al 1 öde is ORDER-presentation: n = buyQuantity = 2.
    //   customer pays 800/2 = 400 per unit · seller settles 800 − 0.4 × 400 = 640 per unit
    //   → Trendyol funds 240 per unit · order revenue = 2 × 640 = 1280.
    expect(body.breakdownScope).toBe('order');
    expect(body.price).toBe('1280.00');
    expect(body.breakdown?.saleGross).toBe('1280.00');
    // No per-unit split at order scope. "400 per unit" would be a synthetic average — in a
    // 2 al 1 öde the customer pays 800 for one unit and nothing for the other, so no unit
    // actually costs 400 — and it would sit next to an order-scoped `price` a consumer could
    // subtract it from. The split is reported as basket totals on the result's basket block.
    expect(body.customerPaidUnitPrice).toBeNull();
    expect(body.trendyolFundedUnitAmount).toBeNull();
    // n× product cost, 1× shipping, 1× platform service (per parcel).
    expect(body.breakdown?.costGross).toBe('40.00');
    // The basket block: customer pays 2 × 400 = 800, Trendyol funds 1280 − 800 = 480, and the
    // order profit is the breakdown's own — the very block the row's maximum card shows.
    expect(body.basket?.assumedQuantity).toBe(2);
    expect(body.basket?.basketPaidTotal).toBe('800.00');
    expect(body.basket?.trendyolFundedTotal).toBe('480.00');
    expect(body.basket?.orderNetProfit).toBe(body.breakdown?.netProfit);
    expect(body.basket).toEqual((await matchedRow()).maxBasket);
  });

  it('prices the custom scenario from the request body, overriding the stored price', async () => {
    const stored = await estimateJson(fx.matchedItemId, { scenario: 'custom' });
    // Stored 600 → seller settles 600 − 0.4 × 300 = 480 per unit, order 2 × 480 = 960.
    expect(stored.price).toBe('960.00');

    // The screen buffers a different price before saving; the modal must price THAT one.
    const buffered = await estimateJson(fx.matchedItemId, {
      scenario: 'custom',
      customPrice: '500.00',
    });
    expect(buffered.price).toBe('800.00');
    expect(Number(buffered.breakdown?.netProfit)).toBeLessThan(Number(stored.breakdown?.netProfit));
    // The basket is framed on the buffered price too: 2 × 500.
    expect(buffered.basket?.basketTotal).toBe('1000.00');
  });

  async function matchedRow(): Promise<DetailItemWire> {
    const detail = await app.request(base(), {
      headers: { Authorization: bearer(fx.accessToken) },
    });
    expect(detail.status).toBe(200);
    const items = ((await detail.json()) as { items: DetailItemWire[] }).items;
    const row = items.find((i) => i.id === fx.matchedItemId);
    if (row === undefined) throw new Error('matched item missing from the campaign detail');
    return row;
  }

  it("prices the CURRENT scenario per unit — the figure the row's current cell shows", async () => {
    const row = await matchedRow();

    const body = await estimateJson(fx.matchedItemId, { scenario: 'current' });
    // Not participating is a one-unit sale today, so even an ORDER-presentation campaign breaks
    // the current scenario down per unit: the revenue is the current price itself.
    expect(body.breakdownScope).toBe('unit');
    expect(body.price).toBe(CURRENT_PRICE);
    expect(body.breakdown?.saleGross).toBe(CURRENT_PRICE);
    expect(body.basket).toBeNull();
    // The modal totals to the figure the seller clicked.
    expect(body.breakdown?.netProfit).toBe(row.current.netProfit);
    // No campaign, therefore no funding to show.
    expect(body.customerPaidUnitPrice).toBeNull();
    expect(body.trendyolFundedUnitAmount).toBeNull();
  });

  it('reports the unmatched row as not calculable without inventing a breakdown', async () => {
    const body = await estimateJson(fx.unmatchedItemId, { scenario: 'max' });
    expect(body.calculable).toBe(false);
    expect(body.reason).toBe('NO_PRODUCT');
    expect(body.breakdown).toBeNull();
    // The scope is still the campaign's, and order scope carries no per-unit split.
    expect(body.breakdownScope).toBe('order');
    expect(body.customerPaidUnitPrice).toBeNull();
    expect(body.trendyolFundedUnitAmount).toBeNull();
    // The basket's money still adds up (2 × 80); only its profit is unknown.
    expect(body.basket?.basketTotal).toBe('160.00');
    expect(body.basket?.orderNetProfit).toBeNull();
  });

  // ─── Gates ──────────────────────────────────────────────────────────────────

  it('refuses a custom price above the item maximum with 422 CUSTOM_PRICE_ABOVE_MAX', async () => {
    const res = await estimate(fx.matchedItemId, {
      scenario: 'custom',
      customPrice: '900.00',
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'customPrice',
          code: 'CUSTOM_PRICE_ABOVE_MAX',
          meta: expect.objectContaining({ maxPrice: MAX_PRICE }),
        }),
      ]),
    );
  });

  it('refuses a custom scenario with no price anywhere with 422 CUSTOM_PRICE_REQUIRED', async () => {
    const res = await estimate(fx.unmatchedItemId, { scenario: 'custom' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'customPrice', code: 'CUSTOM_PRICE_REQUIRED' }),
      ]),
    );
  });

  it('404s on an item that belongs to another campaign', async () => {
    const other = await prisma.marketplaceCampaignList.create({
      data: {
        organizationId: fx.orgId,
        storeId: fx.storeId,
        name: 'Diğer Kampanya',
        discountType: 'NET',
        valueKind: 'PERCENT',
        value: new Decimal('10'),
        trendyolFundingPct: new Decimal('0'),
      },
    });
    const res = await app.request(
      `/v1/organizations/${fx.orgId}/stores/${fx.storeId}/marketplace-campaigns/${other.id}/items/${fx.matchedItemId}/estimate`,
      {
        method: 'POST',
        headers: { Authorization: bearer(fx.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'max' }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as ProblemWire).code).toBe('NOT_FOUND');
    await prisma.marketplaceCampaignList.delete({ where: { id: other.id } });
  });

  // ─── Target margin ──────────────────────────────────────────────────────────

  it('suggests a price for the calculable item and flags the unmatched one', async () => {
    // Margin grows with price and the price is capped at the item's maximum, so the margin at
    // the ceiling IS the best this item can do. Calibrating the target off it keeps the test
    // honest about the real fee/cost data instead of hard-coding a number that drifts.
    const row = await matchedRow();
    const marginAtCeiling = Number(row.maxScenario.marginPct);
    expect(marginAtCeiling).toBeGreaterThan(1);
    const target = (marginAtCeiling - 1).toFixed(2);

    const res = await targetMargin({ targetMarginPct: target });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TargetMarginWire;

    // Suggestions arrive in the campaign's row order.
    expect(body.suggestions.map((s) => s.itemId)).toEqual([fx.matchedItemId, fx.unmatchedItemId]);

    const matched = body.suggestions[0];
    expect(matched?.reason).toBeNull();
    expect(matched?.price).not.toBeNull();
    // The suggestion is a real campaign price: positive and inside Trendyol's ceiling.
    expect(Number(matched?.price)).toBeGreaterThan(0);
    expect(Number(matched?.price)).toBeLessThanOrEqual(Number(MAX_PRICE));

    // A target BELOW the ceiling's margin must cost less than the ceiling price — otherwise
    // the solver is just echoing the cap back.
    const atCeiling = await targetMargin({ targetMarginPct: marginAtCeiling.toFixed(2) });
    const ceilingBody = (await atCeiling.json()) as TargetMarginWire;
    expect(Number(matched?.price)).toBeLessThan(Number(ceilingBody.suggestions[0]?.price));

    // The unmatched row has no variant, so no economics exist to solve.
    expect(body.suggestions[1]?.price).toBeNull();
    expect(body.suggestions[1]?.reason).toBe('NOT_CALCULABLE');
  });

  it('flags an unreachable target instead of suggesting a price above the maximum', async () => {
    const res = await targetMargin({ targetMarginPct: '95' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TargetMarginWire;
    expect(body.suggestions[0]?.price).toBeNull();
    expect(body.suggestions[0]?.reason).toBe('UNREACHABLE');
  });

  it('WRITES NOTHING — selection and customPrice are identical before and after', async () => {
    const columns = {
      where: { listId: fx.campaignId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, selection: true, customPrice: true, updatedAt: true },
    } as const;

    const before = await prisma.marketplaceCampaignItem.findMany(columns);
    const listBefore = await prisma.marketplaceCampaignList.findUniqueOrThrow({
      where: { id: fx.campaignId },
      select: { updatedAt: true },
    });

    expect((await targetMargin({ targetMarginPct: '10' })).status).toBe(200);
    expect((await targetMargin({ targetMarginPct: '40' })).status).toBe(200);

    const after = await prisma.marketplaceCampaignItem.findMany(columns);
    const listAfter = await prisma.marketplaceCampaignList.findUniqueOrThrow({
      where: { id: fx.campaignId },
      select: { updatedAt: true },
    });

    expect(after).toEqual(before);
    // Not even the parent's updatedAt moved — a selection save bumps it, a suggestion must not.
    expect(listAfter.updatedAt).toEqual(listBefore.updatedAt);
  });

  it('rejects a malformed target margin with 422', async () => {
    const res = await targetMargin({ targetMarginPct: 'abc' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.some((e) => e.code === 'INVALID_TARGET_MARGIN')).toBe(true);
  });

  // ─── Price-sensitive n: each basket follows the price it frames ─────────────

  it('frames each scenario basket on its own price where n follows the price', async () => {
    // Every other ORDER type derives n from a fixed quantity (buyQuantity / nthIndex /
    // minQuantity), so a BUY_X_PAY_Y fixture cannot tell which price framed a basket.
    // CONDITIONAL_BASKET/AMOUNT is the only config where n follows the price —
    // n = ceil(minBasket / price) — so it is the only case that can prove it:
    //   max 800    → n = ceil(1000 / 800) = 2
    //   custom 250 → n = ceil(1000 / 250) = 4
    const patch = await updateCampaign({
      discountType: 'CONDITIONAL_BASKET',
      valueKind: 'AMOUNT',
      value: '100',
      minBasketAmount: '1000',
      trendyolFundingPct: '60',
    });
    expect(patch.status).toBe(200);

    // The seller stays on MAX but keeps a typed custom price — both blocks must exist.
    const saved = await patchSelections({
      mode: 'set',
      selections: [{ itemId: fx.matchedItemId, selection: 'MAX', customPrice: '250.00' }],
    });
    expect(saved.status).toBe(200);

    const row = await matchedRow();
    expect(row.maxBasket?.assumedQuantity).toBe(2);
    expect(row.customBasket?.assumedQuantity).toBe(4);

    // The modal opened from either card reconciles with that card, to the kuruş.
    const max = await estimateJson(fx.matchedItemId, { scenario: 'max' });
    expect(max.basket).toEqual(row.maxBasket);
    const custom = await estimateJson(fx.matchedItemId, { scenario: 'custom' });
    expect(custom.basket).toEqual(row.customBasket);
    expect(custom.breakdown?.netProfit).toBe(row.customBasket?.orderNetProfit);
  });

  // ─── UNIT-presentation campaign: the split has no basket block to hide behind ──

  it('shows the funded split per unit on a Net %X campaign, where there is no basket block', async () => {
    // Three of four live campaigns are "Net %X İndirim" — a UNIT-presentation config whose
    // basket block is null, so these two fields are the ONLY place the seller can see what
    // Trendyol contributed.
    const patch = await updateCampaign({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '20',
      trendyolFundingPct: '60',
    });
    expect(patch.status).toBe(200);

    const body = await estimateJson(fx.matchedItemId, { scenario: 'max' });
    expect(body.breakdownScope).toBe('unit');
    // 800 − 20% = 640 paid; discount 160, Trendyol funds 60% of it = 96 → seller settles 736.
    expect(body.customerPaidUnitPrice).toBe('640.00');
    expect(body.trendyolFundedUnitAmount).toBe('96.00');
    expect(body.price).toBe('736.00');
    expect(body.breakdown?.saleGross).toBe('736.00');
    expect(body.basket).toBeNull();

    // The current scenario is unit scope here, as it is everywhere.
    const current = await estimateJson(fx.matchedItemId, { scenario: 'current' });
    expect(current.breakdownScope).toBe('unit');
    expect(current.price).toBe(CURRENT_PRICE);
  });

  it('zeroes the funded amount when the campaign has no Trendyol funding', async () => {
    const patch = await updateCampaign({
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '20',
      trendyolFundingPct: '0',
    });
    expect(patch.status).toBe(200);

    const body = await estimateJson(fx.matchedItemId, { scenario: 'max' });
    // The seller absorbs the whole discount: what they earn is what the customer paid.
    expect(body.customerPaidUnitPrice).toBe('640.00');
    expect(body.trendyolFundedUnitAmount).toBe('0.00');
    expect(body.price).toBe('640.00');
  });
});

// --- The item variant is resolved from the barcode at read time ---

const RelinkEstimateSchema = z.object({
  calculable: z.boolean(),
  reason: z.string().nullable(),
  commissionPct: z.string().nullable(),
  commissionSource: z.string().nullable(),
  breakdown: z.object({ netProfit: z.string() }).nullable(),
});
const RelinkTargetMarginSchema = z.object({
  suggestions: z.array(
    z.object({ itemId: z.string(), price: z.string().nullable(), reason: z.string().nullable() }),
  ),
});
const RelinkDetailItemSchema = z.object({
  id: z.string(),
  imageUrl: z.string().nullable(),
  calculable: z.boolean(),
  current: z.object({ netProfit: z.string().nullable() }),
  maxScenario: z.object({ marginPct: z.string().nullable() }),
});
const RelinkDetailSchema = z.object({ items: z.array(RelinkDetailItemSchema) });
type RelinkEstimate = z.infer<typeof RelinkEstimateSchema>;
type RelinkSuggestion = z.infer<typeof RelinkTargetMarginSchema>['suggestions'][number];
type RelinkDetailItem = z.infer<typeof RelinkDetailItemSchema>;

describe('Marketplace Campaigns - estimate + target-margin resolve the variant from the barcode', () => {
  // The estimate and the target-margin suggestion resolve each item's variant from its
  // barcode as the store's catalog is now, never from the product_variant_id stored at
  // import (an import-time snapshot). Same economics as the fixture above: 2 al 1 ode at
  // 60% funding, 900 / 800, a costed variant on the synced 18% rate.
  interface RelinkContext {
    accessToken: string;
    userId: string;
    orgId: string;
    storeId: string;
    profileId: string;
  }
  let ctx: RelinkContext;

  beforeAll(async () => {
    await ensureDbReachable();
    await truncateAll();
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');

    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Campaign Estimate Relink Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'marketplace-campaign-estimate-relink-test',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    await ensureFeeDefinitions();

    const profile = await prisma.costProfile.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        name: 'COGS Relink',
        type: 'COGS',
        amountGross: new Decimal('20.00'),
        vatRate: 20,
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId: org.id,
        version: 1,
        name: 'COGS Relink',
        type: 'COGS',
        amountGross: new Decimal('20.00'),
        vatRate: 20,
        changedFields: [],
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
    });

    ctx = {
      accessToken: user.accessToken,
      userId: user.id,
      orgId: org.id,
      storeId: store.id,
      profileId: profile.id,
    };
  });

  async function createImagedProduct(imageUrl: string): Promise<{ id: string }> {
    return prisma.product.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        platformContentId: BigInt(Math.floor(Math.random() * 1e12)),
        productMainId: `pm-${randomUUID().slice(0, 8)}`,
        title: 'Relink Product',
        categoryId: 597n,
        categoryName: 'Bayrak',
        imageUrls: [imageUrl],
      },
      select: { id: true },
    });
  }

  /** A calculable variant: price, VAT, desi, the synced 18% rate and the versioned cost. */
  async function createCostedVariant(productId: string, barcode: string): Promise<{ id: string }> {
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        productId,
        platformVariantId: BigInt(Math.floor(Math.random() * 1e12)),
        barcode,
        stockCode: barcode,
        salePrice: new Decimal(CURRENT_PRICE),
        listPrice: new Decimal(CURRENT_PRICE),
        vatRate: 20,
        dimensionalWeightOverride: new Decimal('1.0'),
        syncedCommissionRate: new Decimal(PRODUCT_COMMISSION_PCT),
      },
      select: { id: true },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: ctx.orgId, profileId: ctx.profileId, productVariantId: variant.id },
    });
    return variant;
  }

  /** A 2 al 1 ode campaign with one item per entry, each with the given stored link. */
  async function seedCampaign(
    entries: ReadonlyArray<{ barcode: string; storedVariantId: string | null }>,
  ): Promise<{ campaignId: string; itemIdOf: (barcode: string) => string }> {
    const list = await prisma.marketplaceCampaignList.create({
      data: {
        organizationId: ctx.orgId,
        storeId: ctx.storeId,
        name: `Relink ${randomUUID().slice(0, 8)}`,
        discountType: 'BUY_X_PAY_Y',
        buyQuantity: 2,
        payQuantity: 1,
        trendyolFundingPct: new Decimal(FUNDING_PCT),
        startsAt: new Date('2026-07-21T05:00:00.000Z'),
        endsAt: new Date('2026-07-28T04:59:00.000Z'),
        createdBy: ctx.userId,
      },
    });
    const ids = new Map<string, string>();
    for (const [position, entry] of entries.entries()) {
      const item = await prisma.marketplaceCampaignItem.create({
        data: {
          organizationId: ctx.orgId,
          storeId: ctx.storeId,
          listId: list.id,
          productVariantId: entry.storedVariantId,
          barcode: entry.barcode,
          productTitle: entry.barcode,
          currentPrice: new Decimal(CURRENT_PRICE),
          maxPrice: new Decimal(MAX_PRICE),
          selection: 'NONE',
          sortOrder: position,
        },
      });
      ids.set(entry.barcode, item.id);
    }
    return {
      campaignId: list.id,
      itemIdOf: (barcode) => {
        const id = ids.get(barcode);
        if (id === undefined) throw new Error(`no seeded item for ${barcode}`);
        return id;
      },
    };
  }

  function campaignPath(campaignId: string): string {
    return `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/marketplace-campaigns/${campaignId}`;
  }

  async function postJson(path: string, body: unknown): Promise<unknown> {
    const res = await app.request(path, {
      method: 'POST',
      headers: { Authorization: bearer(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  async function estimateItem(
    campaignId: string,
    itemId: string,
    scenario: 'current' | 'max',
  ): Promise<RelinkEstimate> {
    return RelinkEstimateSchema.parse(
      await postJson(`${campaignPath(campaignId)}/items/${itemId}/estimate`, { scenario }),
    );
  }

  async function suggestionFor(
    campaignId: string,
    itemId: string,
    targetMarginPct: string,
  ): Promise<RelinkSuggestion> {
    const body = RelinkTargetMarginSchema.parse(
      await postJson(`${campaignPath(campaignId)}/target-margin`, { targetMarginPct }),
    );
    const suggestion = body.suggestions.find((s) => s.itemId === itemId);
    if (suggestion === undefined) throw new Error(`no suggestion for item ${itemId}`);
    return suggestion;
  }

  async function detailRow(campaignId: string, itemId: string): Promise<RelinkDetailItem> {
    const res = await app.request(campaignPath(campaignId), {
      headers: { Authorization: bearer(ctx.accessToken) },
    });
    expect(res.status).toBe(200);
    const row = RelinkDetailSchema.parse(await res.json()).items.find((i) => i.id === itemId);
    if (row === undefined) throw new Error(`detail has no item ${itemId}`);
    return row;
  }

  /** Estimate and target margin both see no product (and no commission tier) for the item. */
  async function expectNotPriced(campaignId: string, itemId: string): Promise<void> {
    const estimate = await estimateItem(campaignId, itemId, 'max');
    expect(estimate.calculable).toBe(false);
    expect(estimate.reason).toBe('NO_PRODUCT');
    expect(estimate.breakdown).toBeNull();
    expect(estimate.commissionSource).toBeNull();
    expect(estimate.commissionPct).toBeNull();

    const suggestion = await suggestionFor(campaignId, itemId, '10');
    expect(suggestion.price).toBeNull();
    expect(suggestion.reason).toBe('NOT_CALCULABLE');
  }

  /**
   * Estimate and target margin both price the item: a breakdown on the synced product rate,
   * the modal's current profit equal to the row's, and a real suggestion for a target just
   * below the margin at the ceiling (calibrated off the row, as the fixture tests do).
   */
  async function expectPriced(campaignId: string, itemId: string): Promise<RelinkDetailItem> {
    const row = await detailRow(campaignId, itemId);
    expect(row.calculable).toBe(true);

    const max = await estimateItem(campaignId, itemId, 'max');
    expect(max.calculable).toBe(true);
    expect(max.reason).toBeNull();
    expect(max.breakdown).not.toBeNull();
    expect(max.commissionSource).toBe('product');
    expect(max.commissionPct).toBe('18.0000');

    const current = await estimateItem(campaignId, itemId, 'current');
    expect(current.breakdown?.netProfit).toBe(row.current.netProfit);

    if (row.maxScenario.marginPct === null) throw new Error('the priced row has no margin');
    const marginAtCeiling = new Decimal(row.maxScenario.marginPct);
    expect(marginAtCeiling.gt(1)).toBe(true);
    const target = marginAtCeiling.minus(1).toDecimalPlaces(2, Decimal.ROUND_DOWN).toString();
    const suggestion = await suggestionFor(campaignId, itemId, target);
    expect(suggestion.reason).toBeNull();
    if (suggestion.price === null) throw new Error('the priced item got no suggestion');
    expect(new Decimal(suggestion.price).gt(0)).toBe(true);
    expect(new Decimal(suggestion.price).lte(MAX_PRICE)).toBe(true);
    return row;
  }

  it('prices an item imported before its variant existed once the variant exists, with no re-upload', async () => {
    const { campaignId, itemIdOf } = await seedCampaign([
      { barcode: 'CAMP-EST-LATE', storedVariantId: null },
    ]);
    const itemId = itemIdOf('CAMP-EST-LATE');

    // No catalog variant carries the barcode yet.
    await expectNotPriced(campaignId, itemId);

    // The product sync lands the variant (with a cost and a synced rate) after the upload.
    const product = await createImagedProduct('https://cdn.example/camp-est-late.jpg');
    await createCostedVariant(product.id, 'CAMP-EST-LATE');

    const row = await expectPriced(campaignId, itemId);
    expect(row.imageUrl).toBe('https://cdn.example/camp-est-late.jpg');

    // None of the reads wrote the resolved variant back to the stored link.
    const stored = await prisma.marketplaceCampaignItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { productVariantId: true },
    });
    expect(stored.productVariantId).toBeNull();
  });

  it('prices an item whose stored variant was deleted from the new variant with that barcode', async () => {
    const firstProduct = await createImagedProduct('https://cdn.example/camp-est-v1.jpg');
    const first = await createCostedVariant(firstProduct.id, 'CAMP-EST-RELINK');
    const { campaignId, itemIdOf } = await seedCampaign([
      { barcode: 'CAMP-EST-RELINK', storedVariantId: first.id },
    ]);
    const itemId = itemIdOf('CAMP-EST-RELINK');

    await prisma.productVariant.delete({ where: { id: first.id } });
    const secondProduct = await createImagedProduct('https://cdn.example/camp-est-v2.jpg');
    await createCostedVariant(secondProduct.id, 'CAMP-EST-RELINK');

    const row = await expectPriced(campaignId, itemId);
    expect(row.imageUrl).toBe('https://cdn.example/camp-est-v2.jpg');
  });

  it('does not read a stored id whose variant carries another barcode', async () => {
    const product = await createImagedProduct('https://cdn.example/camp-est-other.jpg');
    const other = await createCostedVariant(product.id, 'CAMP-EST-OTHER');
    const { campaignId, itemIdOf } = await seedCampaign([
      // The stored link points at a calculable variant, but no variant has this barcode.
      { barcode: 'CAMP-EST-STALE', storedVariantId: other.id },
      // Control: the same variant prices an item that carries its own barcode.
      { barcode: 'CAMP-EST-OTHER', storedVariantId: null },
    ]);

    await expectNotPriced(campaignId, itemIdOf('CAMP-EST-STALE'));
    await expectPriced(campaignId, itemIdOf('CAMP-EST-OTHER'));
  });
});
