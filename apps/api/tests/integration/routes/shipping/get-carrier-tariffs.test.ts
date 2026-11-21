/**
 * Integration test — GET /v1/organizations/:orgId/shipping-carriers/:carrierId/tariffs
 *
 * Per PR 7 feedback (Issue 5). The endpoint exposes the desi-bazlı tariff
 * table and (when applicable) the Barem desteği tier table for a single
 * carrier so the store settings UI can render the current values inline.
 *
 * The 10 TRENDYOL carriers + their tariff versions and rows are seeded by the
 * `20261121090000_shipping_tariff_versions` reference seed — `truncateAll`
 * deliberately does NOT wipe `shipping_carriers` / `shipping_tariff_versions` /
 * `shipping_desi_tariffs` / `shipping_barem_tariffs` (platform reference, not
 * tenant data), so the test reads the seeded data directly without per-test setup.
 *
 * Four cases:
 *   1. Dated versions - a TEST_ carrier with 2000, 2020 and 2099 versions
 *      returns only the in-force (2020) version's rows and Barem attributes.
 *   2. No version in force - a TEST_ carrier with only a 2099 version returns
 *      empty tariff lists and no Barem support.
 *   3. Happy path — SENDEOMP (a Barem-eligible carrier) returns desiTariffs
 *      + baremTariffs, both as stringified Decimals (KDV hariç).
 *   4. 404 on unknown carrier id — uuid that does not exist returns
 *      NOT_FOUND without leaking the difference between "never existed"
 *      and "deactivated".
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { Platform } from '@pazarsync/db/enums';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { createMembership, createOrganization } from '../../../helpers/factories';

interface CarrierTariffsResponse {
  carrier: {
    id: string;
    code: string;
    platform: 'TRENDYOL' | 'HEPSIBURADA';
    supportsBaremDestek: boolean;
    maxBaremDesi: number;
  };
  desiTariffs: { desi: number; priceNet: string }[];
  baremTariffs: {
    minOrderAmount: string;
    maxOrderAmount: string;
    priceNet: string;
  }[];
}

interface ProblemDetailsWire {
  code: string;
  status: number;
}

// Two TEST_ carriers. The shipping reference tables are never truncated: the
// carriers are created in beforeAll and deleted in afterAll (their versions and rows
// cascade).
//
// TEST_TARIFFS_ROUTE has three versions: 2000 (no Barem), 2020 (Barem, the version
// in force today) and 2099 (no Barem). The in-force version is neither the oldest
// nor the newest, so reading the versions in the wrong order fails the test.
// TEST_TARIFFS_NO_VERSION only has a 2099 version (Barem-supported, with rows), so
// no version is in force today.
const VERSIONED_CARRIER_CODE = 'TEST_TARIFFS_ROUTE';
const VERSIONED_CARRIER_EXTERNAL_ID = 990_304;
const NO_VERSION_CARRIER_CODE = 'TEST_TARIFFS_NO_VERSION';
const NO_VERSION_CARRIER_EXTERNAL_ID = 990_307;

interface TestBaremBand {
  minOrderAmount: string;
  maxOrderAmount: string;
  priceNet: string;
}

interface TestTariffVersion {
  start: Date;
  supportsBaremDestek: boolean;
  maxBaremDesi: number;
  desi1PriceNet: string;
  baremBands: readonly TestBaremBand[];
}

interface TestCarrierSpec {
  code: string;
  externalId: number;
  displayName: string;
  versions: readonly TestTariffVersion[];
}

const VERSIONED_CARRIER: TestCarrierSpec = {
  code: VERSIONED_CARRIER_CODE,
  externalId: VERSIONED_CARRIER_EXTERNAL_ID,
  displayName: 'Test Tariffs Route',
  versions: [
    {
      start: new Date('2000-01-01T00:00:00.000Z'),
      supportsBaremDestek: false,
      maxBaremDesi: 5,
      desi1PriceNet: '80.00',
      baremBands: [],
    },
    {
      start: new Date('2020-01-01T00:00:00.000Z'),
      supportsBaremDestek: true,
      maxBaremDesi: 10,
      desi1PriceNet: '100.00',
      baremBands: [{ minOrderAmount: '0.00', maxOrderAmount: '199.99', priceNet: '50.00' }],
    },
    {
      start: new Date('2099-01-01T00:00:00.000Z'),
      supportsBaremDestek: false,
      maxBaremDesi: 10,
      desi1PriceNet: '999.00',
      baremBands: [],
    },
  ],
};

const NO_VERSION_CARRIER: TestCarrierSpec = {
  code: NO_VERSION_CARRIER_CODE,
  externalId: NO_VERSION_CARRIER_EXTERNAL_ID,
  displayName: 'Test Tariffs No Version',
  versions: [
    {
      start: new Date('2099-01-01T00:00:00.000Z'),
      supportsBaremDestek: true,
      maxBaremDesi: 10,
      desi1PriceNet: '999.00',
      baremBands: [{ minOrderAmount: '0.00', maxOrderAmount: '199.99', priceNet: '40.00' }],
    },
  ],
};

async function deleteTestCarrier(code: string): Promise<void> {
  await prisma.shippingCarrier.deleteMany({ where: { platform: Platform.TRENDYOL, code } });
}

/** Creates the carrier and its versions with their rows; returns its id. */
async function createTestCarrier(spec: TestCarrierSpec): Promise<string> {
  const carrier = await prisma.shippingCarrier.create({
    data: {
      platform: Platform.TRENDYOL,
      externalId: spec.externalId,
      code: spec.code,
      displayName: spec.displayName,
    },
  });
  for (const version of spec.versions) {
    await prisma.shippingTariffVersion.create({
      data: {
        carrierId: carrier.id,
        effectiveFrom: version.start,
        supportsBaremDestek: version.supportsBaremDestek,
        maxBaremDesi: version.maxBaremDesi,
        maxBaremEligibleDeliveryDuration: 1,
        desiTariffs: {
          create: [{ desi: 1, priceNet: version.desi1PriceNet }],
        },
        baremTariffs: {
          create: version.baremBands.map((band) => ({
            minOrderAmount: band.minOrderAmount,
            maxOrderAmount: band.maxOrderAmount,
            priceNet: band.priceNet,
          })),
        },
      },
    });
  }
  return carrier.id;
}

describe('GET /v1/organizations/:orgId/shipping-carriers/:carrierId/tariffs', () => {
  const app = createApp();
  let versionedCarrierId = '';
  let noVersionCarrierId = '';

  beforeAll(async () => {
    await ensureDbReachable();
    await deleteTestCarrier(VERSIONED_CARRIER_CODE);
    await deleteTestCarrier(NO_VERSION_CARRIER_CODE);
    versionedCarrierId = await createTestCarrier(VERSIONED_CARRIER);
    noVersionCarrierId = await createTestCarrier(NO_VERSION_CARRIER);
  });

  afterAll(async () => {
    await deleteTestCarrier(VERSIONED_CARRIER_CODE);
    await deleteTestCarrier(NO_VERSION_CARRIER_CODE);
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns the version in force today, not the future one', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/shipping-carriers/${versionedCarrierId}/tariffs`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as CarrierTariffsResponse;
    // Everything comes from the 2020 version. The route serialises Prisma.Decimal
    // with toString(), which drops trailing zeros: 100.00 is "100" on the wire. The
    // 2000 row (80.00) and the 2099 row (999.00) must not appear at all.
    expect(body.desiTariffs).toEqual([{ desi: 1, priceNet: '100' }]);
    expect(body.baremTariffs).toEqual([
      { minOrderAmount: '0', maxOrderAmount: '199.99', priceNet: '50' },
    ]);
    expect(body.carrier.supportsBaremDestek).toBe(true);
    expect(body.carrier.maxBaremDesi).toBe(10);
  });

  it('returns empty tariffs and no Barem support when no version is in force', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/shipping-carriers/${noVersionCarrierId}/tariffs`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as CarrierTariffsResponse;
    // The 2099 version's rows and Barem flag must not leak into the response.
    expect(body.desiTariffs).toEqual([]);
    expect(body.baremTariffs).toEqual([]);
    expect(body.carrier.supportsBaremDestek).toBe(false);
    expect(body.carrier.maxBaremDesi).toBe(0);
  });

  it('returns desi + Barem tariff tables for SENDEOMP', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    expect(carrier).not.toBeNull();

    const res = await app.request(
      `/v1/organizations/${org.id}/shipping-carriers/${carrier?.id}/tariffs`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as CarrierTariffsResponse;
    expect(body.carrier.code).toBe('SENDEOMP');
    expect(body.carrier.supportsBaremDestek).toBe(true);
    // The seed migration ships ≥1 desi row per carrier; assert non-empty +
    // monotonic desi ordering rather than pinning to a specific length.
    expect(body.desiTariffs.length).toBeGreaterThan(0);
    expect(typeof body.desiTariffs[0]?.priceNet).toBe('string');
    expect(typeof body.desiTariffs[0]?.desi).toBe('number');
    // A Barem-eligible carrier ships ≥1 tier row.
    expect(body.baremTariffs.length).toBeGreaterThan(0);
    expect(typeof body.baremTariffs[0]?.priceNet).toBe('string');
  });

  it('returns 404 for an unknown carrier id', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const phantomCarrierId = '00000000-0000-4000-a000-000000000000';

    const res = await app.request(
      `/v1/organizations/${org.id}/shipping-carriers/${phantomCarrierId}/tariffs`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('NOT_FOUND');
  });
});
