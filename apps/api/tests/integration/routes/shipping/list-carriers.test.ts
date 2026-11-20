/**
 * Integration test — GET /v1/organizations/:orgId/shipping-carriers
 *
 * Per spec §6.2 / plan Task 3.8. The carrier catalogue is global, read-only
 * reference data — every authenticated org member sees the same 10
 * TRENDYOL rows seeded by the `20260517085409_shipping_tariffs` migration.
 *
 * The test asserts:
 *   1. Happy path — `platform=TRENDYOL` returns exactly 10 carriers and the
 *      list includes SENDEOMP (a representative entry from the seed).
 *   2. Auth boundary — missing Authorization header returns 401 before the
 *      handler is reached.
 *   3. Dated versions - a TEST_ carrier (created and deleted inside the test)
 *      reports its Barem attributes from the tariff version in force.
 *
 * No DB seeding is needed here: `truncateAll` does NOT wipe
 * `shipping_carriers` (it is not in the truncate list because it is
 * platform reference data, not tenant data). The migration's INSERTs
 * persist across test runs the way `auth.users` does.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { Platform } from '@pazarsync/db/enums';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { createMembership, createOrganization } from '../../../helpers/factories';

interface CarrierWire {
  id: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
  externalId: number;
  code: string;
  displayName: string;
  supportsBaremDestek: boolean;
  maxBaremDesi: number;
  sortOrder: number;
}

interface ListCarriersResponse {
  data: CarrierWire[];
}

describe('GET /v1/organizations/:orgId/shipping-carriers', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 10 carriers filtered by platform=TRENDYOL', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/shipping-carriers?platform=TRENDYOL`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ListCarriersResponse;
    expect(body.data).toHaveLength(10);
    const sendeo = body.data.find((c) => c.code === 'SENDEOMP');
    expect(sendeo).toBeDefined();
    expect(sendeo?.platform).toBe('TRENDYOL');
  });

  // The test carrier lives only inside this test (created here, deleted in finally),
  // because the test above expects exactly the 10 seeded TRENDYOL carriers. The legacy
  // carrier Barem columns (still required until they are dropped) deliberately
  // disagree with the version in force, so a response read off the carrier row would
  // show. Its 2000 and 2099 versions do not support Barem and must not be reported.
  it('reports Barem support from the version in force', async () => {
    const code = 'TEST_LIST_CARRIERS';
    await prisma.shippingCarrier.deleteMany({ where: { platform: Platform.TRENDYOL, code } });
    const carrier = await prisma.shippingCarrier.create({
      data: {
        platform: Platform.TRENDYOL,
        externalId: 990_305,
        code,
        displayName: 'Test List Carriers',
        supportsBaremDestek: false,
        maxBaremDesi: 0,
        maxBaremEligibleDeliveryDuration: 0,
      },
    });

    try {
      // 2000 (no Barem, max desi 5), 2020 (Barem, max desi 10: the version in force)
      // and 2099 (no Barem). The in-force version is neither the oldest nor the
      // newest, so reading the versions in the wrong order fails the test.
      const versions = [
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
      ];
      for (const version of versions) {
        await prisma.shippingTariffVersion.create({
          data: {
            carrierId: carrier.id,
            effectiveFrom: version.start,
            supportsBaremDestek: version.supportsBaremDestek,
            maxBaremDesi: version.maxBaremDesi,
            maxBaremEligibleDeliveryDuration: 1,
            desiTariffs: {
              create: [
                {
                  carrierId: carrier.id,
                  desi: 1,
                  priceNet: version.desi1PriceNet,
                  effectiveFrom: version.start,
                },
              ],
            },
            baremTariffs: {
              create: version.baremBands.map((band) => ({
                carrierId: carrier.id,
                minOrderAmount: band.minOrderAmount,
                maxOrderAmount: band.maxOrderAmount,
                priceNet: band.priceNet,
                effectiveFrom: version.start,
              })),
            },
          },
        });
      }

      const user = await createAuthenticatedTestUser();
      const org = await createOrganization();
      await createMembership(org.id, user.id);

      const res = await app.request(
        `/v1/organizations/${org.id}/shipping-carriers?platform=TRENDYOL`,
        { headers: { Authorization: bearer(user.accessToken) } },
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as ListCarriersResponse;
      const testCarrier = body.data.find((c) => c.code === code);
      expect(testCarrier).toBeDefined();
      expect(testCarrier?.supportsBaremDestek).toBe(true);
      expect(testCarrier?.maxBaremDesi).toBe(10);
    } finally {
      await prisma.shippingCarrier.delete({ where: { id: carrier.id } });
    }
  });

  it('returns 401 without auth header', async () => {
    const org = await createOrganization();

    const res = await app.request(`/v1/organizations/${org.id}/shipping-carriers`);

    expect(res.status).toBe(401);
  });
});
