import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
  createWebhookEvent,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * webhook_events RLS: org-scoped SELECT (PR-C1).
 *
 * Webhook handler postgres role kullanır — INSERT/UPDATE/DELETE policy YOK,
 * default-deny. Authenticated user'lar yalnız `is_org_member()` ile SELECT
 * yapabilir (debugging / admin için).
 */
describe('RLS — webhook_events', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only WebhookEvent rows from own org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    const [eventA] = await Promise.all([
      createWebhookEvent(orgA.id, storeA.id, {
        platformOrderId: 'pkg-A-1',
        platformStatus: 'Delivered',
      }),
      createWebhookEvent(orgB.id, storeB.id, {
        platformOrderId: 'pkg-B-1',
        platformStatus: 'Shipped',
      }),
    ]);

    const { data, error } = await client.from('webhook_events').select('id,platform_order_id');

    expect(error).toBeNull();
    expect(data?.map((e) => e.id)).toEqual([eventA.id]);
  });

  it('non-member sees nothing', async () => {
    const { user: outsider, client } = await createRlsScopedClient();
    // outsider'ın hiçbir org üyeliği yok
    const ownerOnlyOrg = await createOrganization();
    const ownerUser = await createUserProfile();
    await createMembership(ownerOnlyOrg.id, ownerUser.id, 'OWNER');
    const store = await createStore(ownerOnlyOrg.id);
    await createWebhookEvent(ownerOnlyOrg.id, store.id);

    void outsider;
    const { data, error } = await client.from('webhook_events').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('authenticated INSERT denied by default policy', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);

    const { error } = await client.from('webhook_events').insert({
      organization_id: org.id,
      store_id: store.id,
      platform: 'TRENDYOL',
      platform_order_id: 'pkg-attempt',
      platform_status: 'Created',
      platform_last_modified_date: new Date('2026-05-20T10:00:00Z').toISOString(),
      raw_payload: { shipmentPackageId: 99999 },
    });

    // RLS default-deny → INSERT reddedilir.
    expect(error).not.toBeNull();
  });
});
