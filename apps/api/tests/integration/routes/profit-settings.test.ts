/**
 * Happy-path integration tests for the profit-settings routes.
 *
 * Covers: default resolution on a fresh store, PATCH shallow-merge (only the sent key
 * changes; the other resolves to its default), GET reflecting the persisted value, and
 * the raw JSONB storing only the patched key (forward-compatible container).
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

interface ProfitSettingsWire {
  includeStopaj: boolean;
  includeNegativeNetVat: boolean;
}

async function ownerContext(): Promise<{ accessToken: string; orgId: string; storeId: string }> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id); // OWNER by default
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

describe('Profit-settings routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('GET returns resolved defaults for a fresh store', async () => {
    const { accessToken, orgId, storeId } = await ownerContext();

    const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/profit-settings`, {
      headers: { Authorization: bearer(accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ProfitSettingsWire;
    expect(body).toEqual({ includeStopaj: true, includeNegativeNetVat: false });
  });

  it('PATCH shallow-merges a single key and GET reflects it', async () => {
    const { accessToken, orgId, storeId } = await ownerContext();

    const patchRes = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/profit-settings`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeNegativeNetVat: true }),
      },
    );

    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as ProfitSettingsWire;
    // includeStopaj untouched → resolves to its default (true); includeNegativeNetVat updated.
    expect(patched).toEqual({ includeStopaj: true, includeNegativeNetVat: true });

    // GET reflects the persisted change.
    const getRes = await app.request(
      `/v1/organizations/${orgId}/stores/${storeId}/profit-settings`,
      { headers: { Authorization: bearer(accessToken) } },
    );
    expect((await getRes.json()) as ProfitSettingsWire).toEqual({
      includeStopaj: true,
      includeNegativeNetVat: true,
    });

    // Raw JSONB stores ONLY the patched key (shallow-merge, not the full resolved object).
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { profitSettings: true },
    });
    expect(store.profitSettings).toEqual({ includeNegativeNetVat: true });
  });

  it('PATCH can disable stopaj and is preserved across a second merge', async () => {
    const { accessToken, orgId, storeId } = await ownerContext();
    const url = `/v1/organizations/${orgId}/stores/${storeId}/profit-settings`;
    const headers = { Authorization: bearer(accessToken), 'Content-Type': 'application/json' };

    await app.request(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ includeStopaj: false }),
    });
    const second = await app.request(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ includeNegativeNetVat: true }),
    });

    expect(second.status).toBe(200);
    // First PATCH's includeStopaj=false must survive the second PATCH (shallow-merge).
    expect((await second.json()) as ProfitSettingsWire).toEqual({
      includeStopaj: false,
      includeNegativeNetVat: true,
    });
  });
});
