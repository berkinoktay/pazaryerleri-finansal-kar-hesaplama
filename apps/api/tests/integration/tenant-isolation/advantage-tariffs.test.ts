// Route-layer authorization for the store-scoped advantage-tariffs endpoints
// (list / detail / delete / selections / commission-source / estimate / export).
// The storeId in the path MUST belong to the caller's org, and a tariffId/itemId
// from another store must be indistinguishable from missing.
//
// SECURITY.md 3 - existence non-disclosure: a cross-org storeId or tariffId
// returns 404 (not 403), so an attacker cannot probe another tenant's ids. A
// non-member of the org gets 403; no token gets 401.
//
// PLUS a cross-vertical isolation proof: the advantage detail reads the reduced
// commission from ANOTHER vertical (the commission tariffs). That read is
// store-scoped, so Org A's advantage — pinned to Org A's OWN commission tariff —
// must NEVER see Org B's commission tariff bands, even when Org B has the same
// barcode. It resolves Org A's pinned source only, never Org B's rates.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const app = createApp();

/** Seed a minimal Advantage tariff (one item) for a store. Returns the tariff id. */
async function seedTariff(organizationId: string, storeId: string): Promise<string> {
  const tariff = await prisma.advantageTariff.create({
    data: { organizationId, storeId, name: 'Org Advantage Tariff' },
  });
  await prisma.advantageTariffItem.create({
    data: {
      organizationId,
      storeId,
      tariffId: tariff.id,
      barcode: 'BC-1',
      productTitle: 'Ürün',
      currentPrice: '100.00',
      customerPrice: '100.00',
      hasCommissionTariff: false,
      starTiers: [
        { key: 'tier1', upperLimit: '90.00', lowerLimit: '85.00' },
        { key: 'tier2', upperLimit: '84.99', lowerLimit: '70.00' },
        { key: 'tier3', upperLimit: '69.99' },
      ],
      applyUntilEnd: false,
      sortOrder: 0,
    },
  });
  return tariff.id;
}

describe('advantage-tariffs: route-layer authorization', () => {
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
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/advantage-tariffs`,
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
      `/v1/organizations/${org.id}/stores/${store.id}/advantage-tariffs`,
      { headers: { Authorization: bearer(outsider.accessToken) } },
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a request with no auth token returns 401', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/advantage-tariffs`,
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/advantage-tariffs`,
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/advantage-tariffs/${tariffB}`,
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/advantage-tariffs/${tariffB}`,
      { method: 'DELETE', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);

    // The cross-tenant tariff must still exist in Org B.
    const stillThere = await prisma.advantageTariff.findUnique({ where: { id: tariffB } });
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/advantage-tariffs/${tariffB}/selections`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: [{ itemId: crypto.randomUUID(), tier: 'tier1', customPrice: null }],
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
    const tariff = await seedTariff(org.id, store.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/advantage-tariffs/${tariff}/selections`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(outsider.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selections: [{ itemId: crypto.randomUUID(), tier: 'tier1', customPrice: null }],
        }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("Org A member pinning a commission source on Org B's tariff via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/advantage-tariffs/${tariffB}/commission-source`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ commissionSourceTariffId: null }),
      },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
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
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/advantage-tariffs/${tariffB}/items/${crypto.randomUUID()}/estimate`,
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
      `/v1/organizations/${org.id}/stores/${store.id}/advantage-tariffs/${tariff}/items/${crypto.randomUUID()}/estimate`,
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
      `/v1/organizations/${org.id}/stores/${store.id}/advantage-tariffs/${tariff}/items/${crypto.randomUUID()}/estimate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: '100.00' }),
      },
    );
    expect(res.status).toBe(401);
  });

  it("Org A member exporting Org B's tariff via Org A's store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const tariffB = await seedTariff(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/advantage-tariffs/${tariffB}/export`,
      { method: 'POST', headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A's advantage detail never reads Org B's commission tariff bands (cross-vertical isolation)", async () => {
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    if (carrier === null) {
      throw new Error(
        'SENDEOMP carrier missing - globalSetup ensureShippingReferenceData must run',
      );
    }

    // ─── Org A: an advantage tariff with a fully-costed matched product, PINNED to
    //     Org A's own commission tariff (which has no band for this barcode, and no
    //     category rate seeded). ─────────────────────────────────────────────────
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await prisma.store.create({
      data: {
        organizationId: orgA.id,
        name: 'Org A Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'iso-adv-a',
        credentials: 'opaque',
        shippingTariffSource: 'TRENDYOL_CONTRACT',
        defaultShippingCarrierId: carrier.id,
      },
    });
    const productA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: 7001n,
        productMainId: 'pm-iso-a',
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
        platformVariantId: 70010n,
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

    // Org A's OWN commission tariff: an active period, but NO band for this barcode.
    // The advantage pins to it, so the source resolves to Org A's tariff — Org B's
    // matching band stays invisible and the item falls to NO_COMMISSION.
    const commissionA = await prisma.commissionTariff.create({
      data: { organizationId: orgA.id, storeId: storeA.id, name: 'Org A Komisyon' },
    });
    const nowA = Date.now();
    await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        tariffId: commissionA.id,
        dateRangeLabel: '7 - 14 Temmuz',
        startsAt: new Date(nowA - 86_400_000),
        endsAt: new Date(nowA + 86_400_000),
        sortOrder: 0,
      },
    });

    const tariffA = await prisma.advantageTariff.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        name: 'Org A Advantage',
        commissionSourceTariffId: commissionA.id,
      },
    });
    await prisma.advantageTariffItem.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        tariffId: tariffA.id,
        productVariantId: variantA.id,
        barcode: 'TB100X150A',
        stockCode: 'TB100X150A',
        productTitle: 'Bayrak',
        currentPrice: '360.00',
        customerPrice: '360.00',
        hasCommissionTariff: true,
        starTiers: [
          { key: 'tier1', upperLimit: '292.91', lowerLimit: '274.43' },
          { key: 'tier2', upperLimit: '274.42', lowerLimit: '223.79' },
          { key: 'tier3', upperLimit: '223.78' },
        ],
        applyUntilEnd: false,
        sortOrder: 0,
      },
    });

    // ─── Org B: a commission tariff with an ACTIVE period whose bands match the
    //     SAME barcode. If the read leaked across tenants, Org A's tiers would show
    //     these band rates. ────────────────────────────────────────────────────
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const commissionB = await prisma.commissionTariff.create({
      data: { organizationId: orgB.id, storeId: storeB.id, name: 'Org B Komisyon' },
    });
    const now = Date.now();
    const periodB = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        tariffId: commissionB.id,
        dateRangeLabel: '7 - 14 Temmuz',
        startsAt: new Date(now - 86_400_000),
        endsAt: new Date(now + 86_400_000),
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
          { key: 'band2', lowerLimit: '280.00', upperLimit: '299.99', commissionPct: '13.1' },
          { key: 'band3', lowerLimit: '250.00', upperLimit: '279.99', commissionPct: '11.5' },
          { key: 'band4', upperLimit: '249.99', commissionPct: '8.8' },
        ],
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/advantage-tariffs/${tariffA.id}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      commissionSourceMode: string;
      commissionSource: { tariffId: string } | null;
      items: {
        barcode: string;
        calculable: boolean;
        reason: string | null;
        tiers: { commissionSource: string | null }[];
      }[];
    };

    // The source resolves to Org A's OWN pinned commission tariff — never Org B's.
    expect(body.commissionSourceMode).toBe('pinned');
    expect(body.commissionSource?.tariffId).toBe(commissionA.id);

    // The matched item's econ is fine (cost + shipping present); the ONLY missing
    // input is a commission rate. Org A's pinned tariff has no band for this barcode
    // and Org B's matching band is invisible → the item is not calculable with
    // reason NO_COMMISSION, and no tier ever shows a 'band' source (the leak
    // signature).
    const item = body.items.find((i) => i.barcode === 'TB100X150A');
    expect(item?.calculable).toBe(false);
    expect(item?.reason).toBe('NO_COMMISSION');
    expect(item?.tiers.every((t) => t.commissionSource !== 'band')).toBe(true);
  });
});
