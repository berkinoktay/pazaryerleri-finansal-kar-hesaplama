/**
 * Integration test — GET /v1/organizations/:orgId/stores/:storeId/own-shipping-tariff
 *
 * Per spec §6.2 / plan Task 3.11. The OWN_CONTRACT tariff list is V1-empty
 * by design — Excel/CSV upload ships later. The route exists so the frontend
 * can render the "yakında" empty state and pre-wire the data path. This test
 * locks in the empty-array contract so a future drift (e.g. someone seeding
 * rows in a migration) trips an assertion instead of silently changing the
 * UI's empty state.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../../helpers/factories';

interface OwnTariffResponse {
  data: { id: string; desi: number; priceNet: string }[];
}

describe('GET /v1/organizations/:orgId/stores/:storeId/own-shipping-tariff', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns empty data array in V1', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/own-shipping-tariff`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as OwnTariffResponse;
    expect(body.data).toEqual([]);
  });
});
