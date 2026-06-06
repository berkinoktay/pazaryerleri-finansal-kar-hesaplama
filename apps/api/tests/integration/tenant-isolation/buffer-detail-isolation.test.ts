import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

describe('Tenant isolation: buffer-detail', () => {
  const app = createApp();
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it("a member of org A cannot read org B's buffer entry", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id, 'OWNER');

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const entryB = await createBufferEntry(orgB.id, storeB.id);

    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/live-performance/buffer/${entryB.id}`,
      { headers: { Authorization: bearer(userA.accessToken) } },
    );
    expect([403, 404]).toContain(res.status);
  });
});
