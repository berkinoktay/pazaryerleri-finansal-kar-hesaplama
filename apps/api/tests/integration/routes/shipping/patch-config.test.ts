/**
 * Integration test — PATCH /v1/organizations/:orgId/stores/:storeId/shipping-config
 *
 * Per spec §6.2 / plan Task 3.10. Two cases:
 *   1. Happy path — wiring a TRENDYOL store to SENDEOMP returns 200 with the
 *      updated carrier id AND the nested carrier object (so the UI can
 *      re-render without a follow-up GET).
 *   2. Validation guard — refusing to clear the carrier while leaving
 *      `shippingTariffSource = TRENDYOL_CONTRACT` produces a 422 with the
 *      stable `SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT` code surfaced
 *      under `errors[0].code` (defined in the Zod `.refine` message).
 *
 * The route is gated to OWNER/ADMIN — `createMembership` defaults to OWNER
 * so the role check is satisfied without extra setup.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

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
    platform: 'TRENDYOL' | 'HEPSIBURADA';
  } | null;
}

interface ProblemDetailsWire {
  code: string;
  status: number;
  errors?: { field: string; code: string; meta?: Record<string, unknown> }[];
}

describe('PATCH /v1/organizations/:orgId/stores/:storeId/shipping-config', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('updates carrier successfully (TRENDYOL → SENDEOMP)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id, { platform: 'TRENDYOL' });
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
    expect(carrier).not.toBeNull();

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/shipping-config`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(user.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shippingTariffSource: 'TRENDYOL_CONTRACT',
          defaultShippingCarrierId: carrier?.id ?? null,
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ShippingConfigResponse;
    expect(body.shippingTariffSource).toBe('TRENDYOL_CONTRACT');
    expect(body.defaultShippingCarrierId).toBe(carrier?.id);
    expect(body.defaultShippingCarrier?.code).toBe('SENDEOMP');
    expect(body.defaultShippingCarrier?.platform).toBe('TRENDYOL');
  });

  it('returns 422 when TRENDYOL_CONTRACT without carrierId', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id, { platform: 'TRENDYOL' });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/shipping-config`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(user.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shippingTariffSource: 'TRENDYOL_CONTRACT',
          defaultShippingCarrierId: null,
        }),
      },
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as ProblemDetailsWire;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]?.code).toBe('SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT');
  });
});
