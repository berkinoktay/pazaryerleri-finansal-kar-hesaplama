/**
 * Integration test — GET /v1/organizations/:orgId/stores/:storeId/shipping-config
 *
 * Per spec §6.2 / plan Task 3.9. A freshly created store has
 * `shippingTariffSource = TRENDYOL_CONTRACT` (Prisma default) and no carrier
 * wired in, so the route's first GET must surface the default exactly as
 * the column-level defaults specify — the UI relies on this empty-state to
 * render the "henüz taşıyıcı seçilmedi" CTA without an extra round-trip.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../../helpers/factories';

interface ShippingConfigResponse {
  shippingTariffSource: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
  defaultShippingCarrierId: string | null;
  defaultShippingCarrier: {
    id: string;
    code: string;
  } | null;
}

describe('GET /v1/organizations/:orgId/stores/:storeId/shipping-config', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns default shipping config for newly created store', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/shipping-config`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ShippingConfigResponse;
    expect(body.shippingTariffSource).toBe('TRENDYOL_CONTRACT');
    expect(body.defaultShippingCarrierId).toBeNull();
    expect(body.defaultShippingCarrier).toBeNull();
  });
});
