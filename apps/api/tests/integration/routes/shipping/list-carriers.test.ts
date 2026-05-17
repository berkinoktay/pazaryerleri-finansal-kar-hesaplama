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
 *
 * No DB seeding is needed here: `truncateAll` does NOT wipe
 * `shipping_carriers` (it is not in the truncate list because it is
 * platform reference data, not tenant data). The migration's INSERTs
 * persist across test runs the way `auth.users` does.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

  it('returns 401 without auth header', async () => {
    const org = await createOrganization();

    const res = await app.request(`/v1/organizations/${org.id}/shipping-carriers`);

    expect(res.status).toBe(401);
  });
});
