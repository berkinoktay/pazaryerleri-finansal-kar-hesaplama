/**
 * Multi-tenancy isolation tests for the shipping-config routes.
 *
 * Per spec §9.3 / plan Task 3.12. The shipping-config service must enforce
 * isolation at two layers:
 *
 *   1. Store-scoped lookups filter by `(id, organizationId)` together — a
 *      user authenticated as an org A member who passes an org B store id
 *      in the URL gets 404 NOT_FOUND, never 403 + a leaky existence hint.
 *      Both GET and PATCH must agree on this contract (different code paths
 *      in the service — both verified here).
 *
 *   2. The cross-platform carrier guard fires before the UPDATE, returning
 *      422 SHIPPING_CARRIER_PLATFORM_MISMATCH (dedicated wire code, not
 *      INVALID_REFERENCE) — the frontend renders a specific Turkish message
 *      and cannot fall through to the generic translation.
 *
 * Note: The seed only contains TRENDYOL carriers. The third test creates a
 * HEPSIBURADA carrier inline via Prisma to exercise the mismatch path
 * without waiting for the HEPSIBURADA seed PR.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

interface ProblemDetailsWire {
  code: string;
  status: number;
  errors?: { field: string; code: string; meta?: Record<string, unknown> }[];
}

describe('Tenant isolation — shipping-config routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('user from org A cannot GET shipping-config of org B store', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/shipping-config`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('user from org A cannot PATCH shipping-config of org B store', async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/shipping-config`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(userA.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shippingTariffSource: 'OWN_CONTRACT',
          defaultShippingCarrierId: null,
        }),
      },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('NOT_FOUND');
  });

  it('PATCH with cross-platform carrier returns 422 SHIPPING_CARRIER_PLATFORM_MISMATCH', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const trendyolStore = await createStore(org.id, { platform: 'TRENDYOL' });

    // Seed only ships TRENDYOL carriers — create a HEPSIBURADA row inline so
    // the test does not depend on a later seed migration. `truncateAll` does
    // NOT touch `shipping_carriers`, so this row leaks across tests if not
    // cleaned up. We delete it explicitly at the end.
    const hbCarrier = await prisma.shippingCarrier.create({
      data: {
        platform: 'HEPSIBURADA',
        externalId: 999_999,
        code: 'HBPLACEHOLDER',
        displayName: 'HB Placeholder',
        sortOrder: 100,
      },
    });

    try {
      const res = await app.request(
        `/v1/organizations/${org.id}/stores/${trendyolStore.id}/shipping-config`,
        {
          method: 'PATCH',
          headers: {
            Authorization: bearer(user.accessToken),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            shippingTariffSource: 'TRENDYOL_CONTRACT',
            defaultShippingCarrierId: hbCarrier.id,
          }),
        },
      );

      expect(res.status).toBe(422);
      const body = (await res.json()) as ProblemDetailsWire;
      expect(body.code).toBe('SHIPPING_CARRIER_PLATFORM_MISMATCH');
    } finally {
      await prisma.shippingCarrier.delete({ where: { id: hbCarrier.id } });
    }
  });
});
