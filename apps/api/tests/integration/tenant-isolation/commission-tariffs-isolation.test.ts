// Route-layer authorization for the store-scoped commission-tariffs endpoints
// (list / detail / delete / selections / estimate). The storeId in the path MUST
// belong to the caller's org, and a tariffId/itemId from another store must be
// indistinguishable from missing.
//
// SECURITY.md §3 — existence non-disclosure: a cross-org storeId or tariffId
// returns 404 (not 403), so an attacker cannot probe another tenant's ids. A
// non-member of the org gets 403; no token gets 401.

import { z } from '@hono/zod-openapi';
import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

/** Seed a minimal tariff (one period, one item) for a store. Returns the tariff id. */
async function seedTariff(organizationId: string, storeId: string): Promise<string> {
  const tariff = await prisma.commissionTariff.create({
    data: { organizationId, storeId, name: 'Org Tariff' },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: {
      organizationId,
      storeId,
      tariffId: tariff.id,
      dateRangeLabel: '23 – 26 Haziran',
      sortOrder: 0,
    },
  });
  await prisma.commissionTariffItem.create({
    data: {
      organizationId,
      storeId,
      periodId: period.id,
      barcode: 'BC-1',
      productTitle: 'Ürün',
      currentPrice: '100.00',
      currentCommissionPct: '0.1900',
      bands: [{ key: 'band1', upperLimit: '100.00', commissionPct: '19' }],
    },
  });
  return tariff.id;
}

describe('commission-tariffs: route-layer authorization', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("Org A member listing Org B's storeId returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/commission-tariffs`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member of the org returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs`,
      { headers: { Authorization: bearer(outsider.accessToken) } },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs`,
    );
    expect(res.status).toBe(401);
  });

  it("a member listing their own store never sees another org's tariffs", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it("Org A member fetching Org B's tariff via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs/${tariffB}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A member deleting Org B's tariff via Org A's store returns 404 and leaves it intact", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs/${tariffB}`,
      { method: 'DELETE', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);

    // The cross-tenant tariff must still exist in Org B.
    const stillThere = await prisma.commissionTariff.findUnique({ where: { id: tariffB } });
    expect(stillThere).not.toBeNull();
  });

  it("Org A member saving selections on Org B's tariff via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs/${tariffB}/selections`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: [{ itemId: crypto.randomUUID(), band: 'band1', customPrice: null }],
        }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("does not disclose another store's item through a selection validation error", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);
    const tariffA = await seedTariff(orgA.id, storeA.id);

    // Foreign items: one in another store of the same org, one in another org. Each
    // stores band1 only, so band3 would be refused (BAND_NOT_STORED) on an own item.
    const storeA2 = await createStore(orgA.id);
    await seedTariff(orgA.id, storeA2.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await seedTariff(orgB.id, storeB.id);
    const foreignItems = await prisma.commissionTariffItem.findMany({
      where: { storeId: { in: [storeA2.id, storeB.id] } },
      select: { id: true },
    });
    expect(foreignItems).toHaveLength(2);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs/${tariffA}/selections`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: foreignItems.map((item) => ({
            itemId: item.id,
            band: 'band3',
            customPrice: null,
          })),
        }),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 0 });

    const untouched = await prisma.commissionTariffItem.findMany({
      where: { id: { in: foreignItems.map((item) => item.id) } },
      select: { selectedBand: true },
    });
    expect(untouched).toEqual([{ selectedBand: null }, { selectedBand: null }]);
  });

  it('a non-member saving selections returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);
    const tariff = await seedTariff(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff}/selections`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selections: [{ itemId: crypto.randomUUID(), band: 'band1', customPrice: null }],
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("Org A member estimating on Org B's tariff via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/commission-tariffs/${tariffB}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '100.00' }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member estimating returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);
    const tariff = await seedTariff(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ price: '100.00' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('an estimate request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const tariff = await seedTariff(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-tariffs/${tariff}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '100.00' }),
      },
    );
    expect(res.status).toBe(401);
  });
});

// --- Item -> variant resolution never crosses a tenant or store boundary ---
//
// The detail and the estimate resolve an item's variant from its barcode at read time,
// scoped to the request's organization and store. A variant with the item's barcode in
// another organization, or in another store of the same organization, must never price
// the item -- not even when the item's stored product_variant_id points straight at it.

const RelinkItemSchema = z.object({
  barcode: z.string(),
  imageUrl: z.string().nullable(),
  currentNetProfit: z.string().nullable(),
  calculable: z.boolean(),
  reason: z.string().nullable(),
  bands: z.array(z.object({ netProfit: z.string().nullable() })),
});
const RelinkDetailSchema = z.object({
  periods: z.array(z.object({ items: z.array(RelinkItemSchema) })),
});
const RelinkEstimateSchema = z.object({
  calculable: z.boolean(),
  reason: z.string().nullable(),
  breakdown: z.object({ netProfit: z.string() }).nullable(),
});
type RelinkItem = z.infer<typeof RelinkItemSchema>;

/** A store with the shipping setup the scenario engine needs (SENDEOMP contract). */
async function createShippableStore(organizationId: string): Promise<string> {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (carrier === null) throw new Error('SENDEOMP carrier missing - globalSetup must run');
  const store = await createStore(organizationId);
  await prisma.store.update({
    where: { id: store.id },
    data: { shippingTariffSource: 'TRENDYOL_CONTRACT', defaultShippingCarrierId: carrier.id },
  });
  return store.id;
}

/** A calculable variant (price, VAT, desi, an image and a versioned COGS cost). */
async function seedCalculableVariant(
  organizationId: string,
  storeId: string,
  barcode: string,
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1e9)),
      productMainId: `pm-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Foreign Product',
      imageUrls: ['https://cdn.example/foreign-0.jpg'],
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1e12)),
      barcode,
      stockCode: barcode,
      salePrice: new Decimal('500.00'),
      listPrice: new Decimal('500.00'),
      vatRate: 20,
      dimensionalWeightOverride: new Decimal('3.0'),
    },
  });
  const profile = await prisma.costProfile.create({
    data: {
      organizationId,
      storeId,
      name: `COGS ${crypto.randomUUID().slice(0, 8)}`,
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: 20,
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId,
      version: 1,
      name: profile.name,
      type: 'COGS',
      amountGross: new Decimal('200.00'),
      vatRate: 20,
      changedFields: [],
      effectiveFrom: new Date('2024-01-01T00:00:00Z'),
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId, profileId: profile.id, productVariantId: variant.id },
  });
  return variant.id;
}

/** A tariff with one fully priced item (known prices, commission and a limited band). */
async function seedPricedTariff(
  organizationId: string,
  storeId: string,
  barcode: string,
  storedVariantId: string | null,
): Promise<{ tariffId: string; itemId: string }> {
  const tariff = await prisma.commissionTariff.create({
    data: { organizationId, storeId, name: 'Relink Tariff' },
  });
  const period = await prisma.commissionTariffPeriod.create({
    data: { organizationId, storeId, tariffId: tariff.id, dateRangeLabel: 'Week', sortOrder: 0 },
  });
  const item = await prisma.commissionTariffItem.create({
    data: {
      organizationId,
      storeId,
      periodId: period.id,
      productVariantId: storedVariantId,
      barcode,
      productTitle: barcode,
      currentPrice: '500.00',
      commissionBasePrice: '480.00',
      currentCommissionPct: '19.0000',
      bands: [{ key: 'band1', upperLimit: '600.00', commissionPct: '19' }],
    },
  });
  return { tariffId: tariff.id, itemId: item.id };
}

async function fetchOnlyItem(
  accessToken: string,
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<RelinkItem> {
  const res = await app.request(
    `/v1/organizations/${orgId}/stores/${storeId}/commission-tariffs/${tariffId}`,
    { headers: { Authorization: bearer(accessToken) } },
  );
  expect(res.status).toBe(200);
  const item = RelinkDetailSchema.parse(await res.json()).periods[0]?.items[0];
  if (item === undefined) throw new Error('detail has no item');
  return item;
}

async function expectEstimateNoProduct(
  accessToken: string,
  orgId: string,
  storeId: string,
  tariffId: string,
  itemId: string,
): Promise<void> {
  const res = await app.request(
    `/v1/organizations/${orgId}/stores/${storeId}/commission-tariffs/${tariffId}/items/${itemId}/estimate`,
    {
      method: 'POST',
      headers: { Authorization: bearer(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'current' }),
    },
  );
  expect(res.status).toBe(200);
  const estimate = RelinkEstimateSchema.parse(await res.json());
  expect(estimate.calculable).toBe(false);
  expect(estimate.reason).toBe('NO_PRODUCT');
  expect(estimate.breakdown).toBeNull();
}

function expectNoProduct(item: RelinkItem): void {
  expect(item.calculable).toBe(false);
  expect(item.reason).toBe('NO_PRODUCT');
  expect(item.imageUrl).toBeNull();
  expect(item.currentNetProfit).toBeNull();
  for (const band of item.bands) {
    expect(band.netProfit).toBeNull();
  }
}

describe('commission-tariffs: item variant resolution stays inside the org and store', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it("never prices Org A's item from Org B's variant with the same barcode, even through the stored link", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createShippableStore(orgA.id);

    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await createShippableStore(orgB.id);
    const variantB = await seedCalculableVariant(orgB.id, storeB, 'BC-X');

    // Control: in its own store the variant prices an item with that barcode.
    const own = await seedPricedTariff(orgB.id, storeB, 'BC-X', null);
    const ownItem = await fetchOnlyItem(userB.accessToken, orgB.id, storeB, own.tariffId);
    expect(ownItem.calculable).toBe(true);
    expect(ownItem.currentNetProfit).not.toBeNull();
    expect(ownItem.imageUrl).toBe('https://cdn.example/foreign-0.jpg');

    // Org A's item carries the same barcode and its stored link points at Org B's variant.
    const foreign = await seedPricedTariff(orgA.id, storeA, 'BC-X', variantB);
    expectNoProduct(await fetchOnlyItem(userA.accessToken, orgA.id, storeA, foreign.tariffId));
    await expectEstimateNoProduct(
      userA.accessToken,
      orgA.id,
      storeA,
      foreign.tariffId,
      foreign.itemId,
    );
  });

  it("never prices a store's item from another store's variant of the same organization", async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const storeOne = await createShippableStore(org.id);
    const storeTwo = await createShippableStore(org.id);
    const variantTwo = await seedCalculableVariant(org.id, storeTwo, 'BC-X');

    // Control: in store two the variant prices an item with that barcode.
    const own = await seedPricedTariff(org.id, storeTwo, 'BC-X', null);
    const ownItem = await fetchOnlyItem(user.accessToken, org.id, storeTwo, own.tariffId);
    expect(ownItem.calculable).toBe(true);
    expect(ownItem.currentNetProfit).not.toBeNull();

    // Store one's item carries the same barcode and its stored link points at store two's.
    const other = await seedPricedTariff(org.id, storeOne, 'BC-X', variantTwo);
    expectNoProduct(await fetchOnlyItem(user.accessToken, org.id, storeOne, other.tariffId));
    await expectEstimateNoProduct(user.accessToken, org.id, storeOne, other.tariffId, other.itemId);
  });
});
