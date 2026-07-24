// Route-layer authorization for the store-scoped discount-list endpoints
// (list / detail / config PATCH / selections / estimate / export / import / delete). The
// storeId in the path MUST belong to the caller's org, and a listId/itemId from another
// store must be indistinguishable from missing.
//
// SECURITY.md 3 - existence non-disclosure: a cross-org storeId or listId returns 404
// (not 403), so an attacker cannot probe another tenant's ids. A non-member of the org
// gets 403; no token gets 401.
//
// PLUS a cross-vertical isolation proof: the discount detail resolves each item's reduced
// commission from ANOTHER vertical (the commission tariffs). That read is store-scoped, so
// Org A's discount — resolving against Org A's OWN commission tariffs — must NEVER see
// Org B's commission bands, even when Org B has the same barcode and window.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

// Both campaign dates are required, so a config that must reach the store-access gate
// (rather than 422 on validation first) has to carry them.
const CAMPAIGN_WINDOW = {
  startsAt: '2026-07-21T05:00:00.000Z',
  endsAt: '2026-07-28T04:59:00.000Z',
} as const;

const VALID_CONFIG = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '10',
  ...CAMPAIGN_WINDOW,
} as const;

// A dummy file plus a VALID config passes the import form validation and reaches the
// store-access gate — form validation runs before the store-access gate, so a
// file-only form would 422 before the 404 (see discount-lists-import.routes.test.ts).
const VALID_IMPORT_CONFIG = {
  discountType: 'NET',
  valueKind: 'PERCENT',
  value: '20',
  ...CAMPAIGN_WINDOW,
} as const;

// The barcode Org A's discount item and Org B's commission band both use in the
// cross-vertical proof — the collision that would leak if the read were not store-scoped.
const SHARED_BARCODE = 'DISC-ISO-1';

/** Seed a minimal discount list (one item) for a store. Returns the list id. */
async function seedList(organizationId: string, storeId: string): Promise<string> {
  const list = await prisma.discountList.create({
    data: {
      organizationId,
      storeId,
      name: 'Org İndirim Listesi',
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: '10',
    },
  });
  await prisma.discountListItem.create({
    data: {
      organizationId,
      storeId,
      listId: list.id,
      barcode: 'BC-1',
      productTitle: 'Ürün',
      currentPrice: '100.00',
      included: false,
      sortOrder: 0,
    },
  });
  return list.id;
}

describe('discount-lists: route-layer authorization', () => {
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
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/discount-lists`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member of the org returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/discount-lists`, {
      headers: { Authorization: bearer(outsider.accessToken) },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(`/v1/organizations/${org.id}/stores/${store.id}/discount-lists`);
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/discount-lists`,
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/discount-lists/${listB}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A member updating Org B's list config via Org A's store returns 404 and leaves it intact", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const listB = await seedList(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/discount-lists/${listB}`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...VALID_CONFIG, name: 'Hijacked' }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');

    const untouched = await prisma.discountList.findUnique({ where: { id: listB } });
    expect(untouched?.name).toBe('Org İndirim Listesi');
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/discount-lists/${listB}/selections`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'set',
          selections: [{ itemId: crypto.randomUUID(), included: true }],
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
      `/v1/organizations/${org.id}/stores/${store.id}/discount-lists/${list}/selections`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'set',
          selections: [{ itemId: crypto.randomUUID(), included: true }],
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/discount-lists/${listB}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'discounted' }),
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
      `/v1/organizations/${org.id}/stores/${store.id}/discount-lists/${list}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scenario: 'current' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('an estimate request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const list = await seedList(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/discount-lists/${list}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'current' }),
      },
    );
    expect(res.status).toBe(401);
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/discount-lists/${listB}`,
      { method: 'DELETE', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);

    const stillThere = await prisma.discountList.findUnique({ where: { id: listB } });
    expect(stillThere).not.toBeNull();
  });

  it("Org A member estimating via Org B's storeId returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // Org B's storeId under Org A's org path: the store-access gate 404s before the
    // list/item are ever looked up, so a random listId/itemId is enough.
    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/discount-lists/${crypto.randomUUID()}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'discounted' }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A member exporting Org B's list via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const listB = await seedList(orgB.id, storeB.id);

    // A foreign listId under the caller's own store is a 404 (list not found), never the
    // 409 (no source file) — the scoped findFirst gates existence before the file check.
    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/discount-lists/${listB}/export`,
      { method: 'POST', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A member exporting via Org B's storeId returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const listB = await seedList(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/discount-lists/${listB}/export`,
      { method: 'POST', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-member exporting returns 403', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);
    const list = await seedList(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/discount-lists/${list}/export`,
      { method: 'POST', headers: { Authorization: bearer(outsider.accessToken) } },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('an export request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const list = await seedList(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/discount-lists/${list}/export`,
      { method: 'POST' },
    );
    expect(res.status).toBe(401);
  });

  it("Org A member importing to Org B's store via Org A's org returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    // A dummy file + a valid config passes form validation and reaches the store-access
    // gate, which 404s BEFORE the file is parsed.
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'indirimler.xlsx');
    for (const [key, value] of Object.entries(VALID_IMPORT_CONFIG)) form.append(key, value);

    const res = await app.request(
      new Request(
        `http://local/v1/organizations/${orgA.id}/stores/${storeB.id}/discount-lists/import`,
        { method: 'POST', headers: { Authorization: bearer(userA.accessToken) }, body: form },
      ),
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A's discount detail never reads Org B's commission tariff bands (cross-vertical isolation)", async () => {
    // ─── Org A: a discount item matched to a variant whose SYNCED commission rate is the
    //     2nd tier of the chain. Org A's OWN commission week covers the item but has NO
    //     band for this barcode, so the item must resolve to 'product', never a band. ───
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const productA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: 7301n,
        productMainId: 'pm-iso-disc-a',
        title: 'İndirim İzolasyon Ürünü',
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
        platformVariantId: 73010n,
        barcode: SHARED_BARCODE,
        stockCode: SHARED_BARCODE,
        salePrice: new Decimal('360.00'),
        listPrice: new Decimal('360.00'),
        vatRate: 20,
        // The synced product rate — the chain's 2nd tier. With no Org A band for this
        // barcode, the item resolves here ('product'), which is provably NOT a band.
        syncedCommissionRate: new Decimal('19'),
      },
    });
    await ensureFeeDefinitions();

    // Org A's OWN commission week (a period, but NO band item for this barcode).
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

    const listA = await prisma.discountList.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        name: 'Org A İndirim',
        discountType: 'NET',
        valueKind: 'PERCENT',
        value: new Decimal('20'),
      },
    });
    const itemA = await prisma.discountListItem.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        listId: listA.id,
        productVariantId: variantA.id,
        barcode: SHARED_BARCODE,
        productTitle: 'İndirim İzolasyon Ürünü',
        currentPrice: '360.00',
        included: true,
        sortOrder: 0,
      },
    });

    // ─── Org B: a commission week (same window) WITH a band for the SAME barcode. If the
    //     read leaked across tenants, the discounted price (288 = 360 −20%) would land in
    //     Org B's 11.5% band and surface source 'band'. ───────────────────────────────
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
        barcode: SHARED_BARCODE,
        productTitle: 'İndirim İzolasyon Ürünü',
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/discount-lists/${listA.id}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        id: string;
        current: { commissionSource: string | null };
        discounted: { commissionSource: string | null };
      }[];
    };

    // Org A's item resolves against Org A's OWN week (no band for this barcode) → the
    // synced product rate. Org B's matching band is invisible at BOTH the current and the
    // discounted price: source 'product', never Org B's 'band'.
    const item = body.items.find((i) => i.id === itemA.id);
    expect(item?.current.commissionSource).toBe('product');
    expect(item?.discounted.commissionSource).toBe('product');
    expect(item?.current.commissionSource).not.toBe('band');
    expect(item?.discounted.commissionSource).not.toBe('band');
  });
});
