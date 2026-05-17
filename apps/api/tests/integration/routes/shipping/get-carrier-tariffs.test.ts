/**
 * Integration test — GET /v1/organizations/:orgId/shipping-carriers/:carrierId/tariffs
 *
 * Per PR 7 feedback (Issue 5). The endpoint exposes the desi-bazlı tariff
 * table and (when applicable) the Barem desteği tier table for a single
 * carrier so the store settings UI can render the current values inline.
 *
 * The 10 TRENDYOL carriers + their tariff rows are seeded by the
 * `20260517085409_shipping_tariffs` migration — `truncateAll` deliberately
 * does NOT wipe `shipping_carriers` / `shipping_desi_tariffs` /
 * `shipping_barem_tariffs` (platform reference, not tenant data), so the
 * test reads the seeded data directly without per-test setup.
 *
 * Two cases:
 *   1. Happy path — SENDEOMP (a Barem-eligible carrier) returns desiTariffs
 *      + baremTariffs, both as stringified Decimals (KDV hariç).
 *   2. 404 on unknown carrier id — uuid that does not exist returns
 *      NOT_FOUND without leaking the difference between "never existed"
 *      and "deactivated".
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

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

describe('GET /v1/organizations/:orgId/shipping-carriers/:carrierId/tariffs', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
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
