// Route-layer authorization for the store-scoped flash-products endpoints
// (list / detail / delete / selections / estimate / import). The storeId in the path
// MUST belong to the caller's org, and a listId/itemId from another store must be
// indistinguishable from missing.
//
// SECURITY.md 3 - existence non-disclosure: a cross-org storeId or listId returns 404
// (not 403), so an attacker cannot probe another tenant's ids. A non-member of the org
// gets 403; no token gets 401.
//
// PLUS a cross-vertical isolation proof: the flash detail resolves each offer's reduced
// commission from ANOTHER vertical (the commission tariffs). That read is store-scoped,
// so Org A's flash — resolving against Org A's OWN commission tariffs — must NEVER see
// Org B's commission bands, even when Org B has the same barcode and window.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { businessZoneEpochToInstant } from '@pazarsync/utils';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

function flashInstant(year: number, month1: number, day: number, hour: number, minute = 0): Date {
  return businessZoneEpochToInstant(Date.UTC(year, month1 - 1, day, hour, minute));
}

/** Seed a minimal flash list (one item) for a store. Returns the list id. */
async function seedList(organizationId: string, storeId: string): Promise<string> {
  const list = await prisma.flashProductList.create({
    data: { organizationId, storeId, name: 'Org Flash List' },
  });
  await prisma.flashProductItem.create({
    data: {
      organizationId,
      storeId,
      listId: list.id,
      barcode: 'BC-1',
      productTitle: 'Ürün',
      currentPrice: '100.00',
      customerPrice: '100.00',
      currentCommissionPct: '19',
      hasCommissionTariff: false,
      offer24Price: '90.00',
      sortOrder: 0,
    },
  });
  return list.id;
}

describe('flash-products: route-layer authorization', () => {
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
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/flash-products`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member of the org returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/flash-products`, {
      headers: { Authorization: bearer(outsider.accessToken) },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/flash-products`);
    expect(res.status).toBe(401);
  });

  it("a member listing their own store never sees another org's lists", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await seedList(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/flash-products`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  it("Org A member fetching Org B's list via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const listB = await seedList(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/flash-products/${listB}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A member deleting Org B's list via Org A's store returns 404 and leaves it intact", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const listB = await seedList(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/flash-products/${listB}`,
      { method: 'DELETE', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);

    const stillThere = await prisma.flashProductList.findUnique({ where: { id: listB } });
    expect(stillThere).not.toBeNull();
  });

  it("Org A member saving selections on Org B's list via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const listB = await seedList(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/flash-products/${listB}/selections`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: [{ itemId: crypto.randomUUID(), offer: 'H24', customPrice: null }],
        }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member saving selections returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);
    const list = await seedList(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/flash-products/${list}/selections`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selections: [{ itemId: crypto.randomUUID(), offer: 'H24', customPrice: null }],
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("Org A member estimating on Org B's list via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const listB = await seedList(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/flash-products/${listB}/items/${crypto.randomUUID()}/estimate`,
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
    const list = await seedList(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/flash-products/${list}/items/${crypto.randomUUID()}/estimate`,
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
    const list = await seedList(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/flash-products/${list}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '100.00' }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("Org A member importing to Org B's store via Org A's org returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // A dummy file is enough to pass form validation and reach the store-access gate,
    // which 404s BEFORE the file is parsed.
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'flas-urunler.xlsx');

    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${orgA.id}/stores/${storeB.id}/flash-products/import`,
        { method: 'POST', headers: { Authorization: bearer(userA.accessToken) }, body: form },
      ),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A's flash detail never reads Org B's commission tariff bands (cross-vertical isolation)", async () => {
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) {
      throw new Error(
        'SENDEOMP carrier missing - globalSetup ensureShippingReferenceData must run',
      );
    }

    // ─── Org A: a flash item with a fully-costed matched product. Org A's OWN
    //     commission week covers the offer window but has NO band for this barcode. ──
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await prisma.store.create({
      data: {
        organizationId: orgA.id,
        name: 'Org A Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'iso-flash-a',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const productA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: 7101n,
        productMainId: 'pm-iso-flash-a',
        title: 'Bayrak',
        categoryId: 597n,
        categoryName: 'Bayrak',
        brandId: 2032n,
        brandName: 'Alpaka',
      },
    });
    const variantA = await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: productA.id,
        platformVariantId: 71010n,
        barcode: 'TB100X150A',
        stockCode: 'TB100X150A',
        salePrice: new Decimal('360.00'),
        listPrice: new Decimal('360.00'),
        vatRate: 20,
        dimensionalWeight: new Decimal('3.0'),
      },
    });
    const profileA = await prisma.costProfile.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        name: 'COGS Test',
        type: 'COGS',
        amountGross: new Decimal('200.00'),
        currency: 'TRY',
        vatRate: 20,
        fxRateMode: 'MANUAL',
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: orgA.id, profileId: profileA.id, productVariantId: variantA.id },
    });
    await ensureFeeDefinitions();

    const weekStart = new Date(Date.UTC(2026, 6, 8, 8, 0));
    const weekEnd = new Date(Date.UTC(2026, 6, 15, 8, 0));
    const commissionA = await prisma.commissionTariff.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        name: 'Org A Komisyon',
        weekStartsAt: weekStart,
        weekEndsAt: weekEnd,
      },
    });
    await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        tariffId: commissionA.id,
        dateRangeLabel: '8 Temmuz 08.00-15 Temmuz 07.59',
        dayCount: 7,
        startsAt: weekStart,
        endsAt: weekEnd,
        sortOrder: 0,
      },
    });

    const listA = await prisma.flashProductList.create({
      data: { organizationId: orgA.id, storeId: storeA.id, name: 'Org A Flaş' },
    });
    const itemA = await prisma.flashProductItem.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        listId: listA.id,
        productVariantId: variantA.id,
        barcode: 'TB100X150A',
        productTitle: 'Bayrak',
        currentPrice: '360.00',
        customerPrice: '360.00',
        currentCommissionPct: '19',
        hasCommissionTariff: true,
        offer24Price: '260.00',
        offer24StartsAt: flashInstant(2026, 7, 9, 0),
        offer24EndsAt: flashInstant(2026, 7, 9, 23, 59),
        sortOrder: 0,
      },
    });

    // ─── Org B: a commission week (same window) WITH a band for the SAME barcode.
    //     If the read leaked across tenants, Org A's offer would show 'band'. ────────
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const commissionB = await prisma.commissionTariff.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        name: 'Org B Komisyon',
        weekStartsAt: weekStart,
        weekEndsAt: weekEnd,
      },
    });
    const periodB = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        tariffId: commissionB.id,
        dateRangeLabel: '8 Temmuz 08.00-15 Temmuz 07.59',
        dayCount: 7,
        startsAt: weekStart,
        endsAt: weekEnd,
        sortOrder: 0,
      },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        periodId: periodB.id,
        barcode: 'TB100X150A',
        productTitle: 'Bayrak',
        currentPrice: '360.00',
        currentCommissionPct: '0.1900',
        bands: [
          { key: 'band1', lowerLimit: '300.00', commissionPct: '19' },
          { key: 'band2', lowerLimit: '250.00', upperLimit: '299.99', commissionPct: '11.5' },
          { key: 'band3', upperLimit: '249.99', commissionPct: '8' },
        ],
        sortOrder: 0,
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/flash-products/${listA.id}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        id: string;
        commissionSource: string;
        commissionBands: unknown | null;
        offer24: { commissionPct: string } | null;
      }[];
    };

    // Org A's item resolves against Org A's OWN week (no band for this barcode) → the
    // flat "Mevcut Komisyon" (19). Org B's matching band is invisible: source 'current',
    // no ladder, offer at the flat 19% — never Org B's 11.5.
    const item = body.items.find((i) => i.id === itemA.id);
    expect(item?.commissionSource).toBe('current');
    expect(item?.commissionBands).toBeNull();
    expect(item?.offer24?.commissionPct).toBe('19.0000');
  });
});
