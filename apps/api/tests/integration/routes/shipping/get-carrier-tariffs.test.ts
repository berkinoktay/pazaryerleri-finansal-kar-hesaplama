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
 * Five cases:
 *   1. Dated versions - a TEST_ carrier with 2000, 2020 and 2099 versions
 *      returns only the in-force (2020) version's rows and Barem attributes.
 *   2. No version in force - a TEST_ carrier with only a 2099 version returns
 *      empty tariff lists and no Barem support.
 *   3. Two Barem tables - a TEST_ carrier whose version in force has table 1
 *      and table 2 bands returns only the table 1 bands.
 *   4. Happy path — SENDEOMP (a Barem-eligible carrier) returns desiTariffs
 *      + baremTariffs, both as stringified Decimals (KDV hariç).
 *   5. 404 on unknown carrier id — uuid that does not exist returns
 *      NOT_FOUND without leaking the difference between "never existed"
 *      and "deactivated".
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { BaremTier, Platform } from '@pazarsync/db/enums';

import { createApp } from '@/app';
import { CarrierTariffsSchema } from '@/validators/shipping-config.validator';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import {
  createMembership,
  createOrganization,
  createTestCarrierWithVersions,
  type CreateTestCarrierWithVersionsSpec,
} from '../../../helpers/factories';

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
// no version is in force today. TEST_TARIFFS_TWO_TIER's version in force carries
// Barem table 1 and table 2 bands.
const VERSIONED_CARRIER_CODE = 'TEST_TARIFFS_ROUTE';
const VERSIONED_CARRIER_EXTERNAL_ID = 990_304;
const NO_VERSION_CARRIER_CODE = 'TEST_TARIFFS_NO_VERSION';
const NO_VERSION_CARRIER_EXTERNAL_ID = 990_307;
const TWO_TIER_CARRIER_CODE = 'TEST_TARIFFS_TWO_TIER';
const TWO_TIER_CARRIER_EXTERNAL_ID = 990_308;

const VERSIONED_CARRIER: CreateTestCarrierWithVersionsSpec = {
  code: VERSIONED_CARRIER_CODE,
  externalId: VERSIONED_CARRIER_EXTERNAL_ID,
  displayName: 'Test Tariffs Route',
  versions: [
    {
      effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
      supportsBaremDestek: false,
      maxBaremDesi: 5,
      desiRows: [{ desi: 1, priceNet: '80.00' }],
      baremRows: [],
    },
    {
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      supportsBaremDestek: true,
      maxBaremDesi: 10,
      desiRows: [{ desi: 1, priceNet: '100.00' }],
      baremRows: [{ minOrderAmount: '0.00', maxOrderAmount: '199.99', priceNet: '50.00' }],
    },
    {
      effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
      supportsBaremDestek: false,
      maxBaremDesi: 10,
      desiRows: [{ desi: 1, priceNet: '999.00' }],
      baremRows: [],
    },
  ],
};

const NO_VERSION_CARRIER: CreateTestCarrierWithVersionsSpec = {
  code: NO_VERSION_CARRIER_CODE,
  externalId: NO_VERSION_CARRIER_EXTERNAL_ID,
  displayName: 'Test Tariffs No Version',
  versions: [
    {
      effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
      supportsBaremDestek: true,
      maxBaremDesi: 10,
      desiRows: [{ desi: 1, priceNet: '999.00' }],
      baremRows: [{ minOrderAmount: '0.00', maxOrderAmount: '199.99', priceNet: '40.00' }],
    },
  ],
};

const TWO_TIER_CARRIER: CreateTestCarrierWithVersionsSpec = {
  code: TWO_TIER_CARRIER_CODE,
  externalId: TWO_TIER_CARRIER_EXTERNAL_ID,
  displayName: 'Test Tariffs Two Tier',
  versions: [
    {
      effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
      supportsBaremDestek: true,
      maxBaremDesi: 10,
      desiRows: [{ desi: 1, priceNet: '100.00' }],
      baremRows: [
        {
          tier: BaremTier.TABLE_1,
          minOrderAmount: '0.00',
          maxOrderAmount: '199.99',
          priceNet: '50.00',
        },
        {
          tier: BaremTier.TABLE_1,
          minOrderAmount: '200.00',
          maxOrderAmount: '349.99',
          priceNet: '70.00',
        },
        {
          tier: BaremTier.TABLE_2,
          minOrderAmount: '0.00',
          maxOrderAmount: '199.99',
          priceNet: '75.00',
        },
        {
          tier: BaremTier.TABLE_2,
          minOrderAmount: '200.00',
          maxOrderAmount: '349.99',
          priceNet: '85.00',
        },
      ],
    },
  ],
};

async function deleteTestCarrier(code: string): Promise<void> {
  await prisma.shippingCarrier.deleteMany({ where: { platform: Platform.TRENDYOL, code } });
}

describe('GET /v1/organizations/:orgId/shipping-carriers/:carrierId/tariffs', () => {
  const app = createApp();
  let versionedCarrierId = '';
  let noVersionCarrierId = '';
  let twoTierCarrierId = '';

  beforeAll(async () => {
    await ensureDbReachable();
    await deleteTestCarrier(VERSIONED_CARRIER_CODE);
    await deleteTestCarrier(NO_VERSION_CARRIER_CODE);
    await deleteTestCarrier(TWO_TIER_CARRIER_CODE);
    versionedCarrierId = await createTestCarrierWithVersions(VERSIONED_CARRIER);
    noVersionCarrierId = await createTestCarrierWithVersions(NO_VERSION_CARRIER);
    twoTierCarrierId = await createTestCarrierWithVersions(TWO_TIER_CARRIER);
  });

  afterAll(async () => {
    await deleteTestCarrier(VERSIONED_CARRIER_CODE);
    await deleteTestCarrier(NO_VERSION_CARRIER_CODE);
    await deleteTestCarrier(TWO_TIER_CARRIER_CODE);
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
    const body = CarrierTariffsSchema.parse(await res.json());
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
    const body = CarrierTariffsSchema.parse(await res.json());
    // The 2099 version's rows and Barem flag must not leak into the response.
    expect(body.desiTariffs).toEqual([]);
    expect(body.baremTariffs).toEqual([]);
    expect(body.carrier.supportsBaremDestek).toBe(false);
    expect(body.carrier.maxBaremDesi).toBe(0);
  });

  it('returns only the Barem table 1 bands when the version has two tables', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/shipping-carriers/${twoTierCarrierId}/tariffs`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = CarrierTariffsSchema.parse(await res.json());
    // The table 2 bands (75.00 and 85.00) must not appear; Prisma.Decimal toString()
    // drops trailing zeros on the wire.
    expect(body.baremTariffs).toEqual([
      { minOrderAmount: '0', maxOrderAmount: '199.99', priceNet: '50' },
      { minOrderAmount: '200', maxOrderAmount: '349.99', priceNet: '70' },
    ]);
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
