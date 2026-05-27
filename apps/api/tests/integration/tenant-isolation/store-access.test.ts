import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrder,
  createOrganization,
  createStore,
} from '../../helpers/factories';

/**
 * Store-access enforcement at the API layer. Prisma runs as the postgres role
 * and bypasses RLS, so the route handlers must check member_store_access
 * themselves (via requireStoreAccess). A MEMBER/VIEWER may only reach the data
 * of stores they were granted; an ungranted store is 404 (non-disclosure),
 * exactly like a store in another org. OWNER/ADMIN reach every store by role.
 */
describe('Store-access — GET /v1/organizations/:orgId/stores/:storeId/orders', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function orgWithTwoStores() {
    const org = await createOrganization();
    const [granted, ungranted] = await Promise.all([
      createStore(org.id, { name: 'Granted' }),
      createStore(org.id, { name: 'Ungranted' }),
    ]);
    await Promise.all([createOrder(org.id, granted.id), createOrder(org.id, ungranted.id)]);
    return { org, granted, ungranted };
  }

  it('MEMBER reaches a granted store', async () => {
    const user = await createAuthenticatedTestUser();
    const { org, granted } = await orgWithTwoStores();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    await createMemberStoreAccess(org.id, member.id, granted.id);

    const res = await app.request(`/v1/organizations/${org.id}/stores/${granted.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('MEMBER gets 404 on an ungranted store in the same org (non-disclosure)', async () => {
    const user = await createAuthenticatedTestUser();
    const { org, granted, ungranted } = await orgWithTwoStores();
    const member = await createMembership(org.id, user.id, 'MEMBER');
    await createMemberStoreAccess(org.id, member.id, granted.id);

    const res = await app.request(`/v1/organizations/${org.id}/stores/${ungranted.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(404);
  });

  it('VIEWER with zero grants gets 404 on every store', async () => {
    const user = await createAuthenticatedTestUser();
    const { org, granted } = await orgWithTwoStores();
    await createMembership(org.id, user.id, 'VIEWER');

    const res = await app.request(`/v1/organizations/${org.id}/stores/${granted.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(404);
  });

  it('OWNER reaches every store without any grant rows', async () => {
    const user = await createAuthenticatedTestUser();
    const { org, ungranted } = await orgWithTwoStores();
    await createMembership(org.id, user.id, 'OWNER');

    const res = await app.request(`/v1/organizations/${org.id}/stores/${ungranted.id}/orders`, {
      headers: { Authorization: bearer(user.accessToken) },
    });

    expect(res.status).toBe(200);
  });
});
