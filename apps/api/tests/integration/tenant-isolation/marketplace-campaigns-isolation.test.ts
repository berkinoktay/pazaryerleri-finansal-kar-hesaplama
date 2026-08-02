// Route-layer authorization for the store-scoped Kampanyalar compute endpoints
// (estimate + target-margin).
//
// SECURITY.md §3 — existence non-disclosure: a cross-org storeId, campaignId or itemId
// returns 404 (never 403), so an attacker cannot probe another tenant's ids by watching the
// status code. A non-member of the org gets 403; no token gets 401.
//
// Both endpoints are POST, so the structural GET backstop in org-scoped-route-coverage
// cannot reach them — they need their own proof.

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

const ESTIMATE_BODY = { scenario: 'max' } as const;
const TARGET_MARGIN_BODY = { targetMarginPct: '20' } as const;

interface SeededCampaign {
  campaignId: string;
  itemId: string;
}

/** Seeds a minimal one-item campaign for a store. */
async function seedCampaign(organizationId: string, storeId: string): Promise<SeededCampaign> {
  const list = await prisma.marketplaceCampaignList.create({
    data: {
      organizationId,
      storeId,
      name: 'Org Kampanyası',
      discountType: 'NET',
      valueKind: 'PERCENT',
      value: new Decimal('10'),
      trendyolFundingPct: new Decimal('50'),
    },
  });
  const item = await prisma.marketplaceCampaignItem.create({
    data: {
      organizationId,
      storeId,
      listId: list.id,
      barcode: 'CAMP-ISO-1',
      productTitle: 'Ürün',
      currentPrice: new Decimal('100.00'),
      maxPrice: new Decimal('80.00'),
      sortOrder: 0,
    },
  });
  return { campaignId: list.id, itemId: item.id };
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token !== undefined ? { Authorization: bearer(token) } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('marketplace-campaigns estimate / target-margin: route-layer authorization', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("Org A member estimating through Org B's storeId returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const seeded = await seedCampaign(orgB.id, storeB.id);

    const res = await post(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/marketplace-campaigns/${seeded.campaignId}/items/${seeded.itemId}/estimate`,
      ESTIMATE_BODY,
      userA.accessToken,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A member estimating Org B's item through their OWN store returns 404", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const seeded = await seedCampaign(orgB.id, storeB.id);

    const res = await post(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/marketplace-campaigns/${seeded.campaignId}/items/${seeded.itemId}/estimate`,
      ESTIMATE_BODY,
      userA.accessToken,
    );
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it("Org A member asking for target-margin on Org B's campaign returns 404 and no suggestions", async () => {
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await createStore(orgA.id);

    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    const seeded = await seedCampaign(orgB.id, storeB.id);

    const res = await post(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/marketplace-campaigns/${seeded.campaignId}/target-margin`,
      TARGET_MARGIN_BODY,
      userA.accessToken,
    );
    expect(res.status).toBe(404);
    // The response body must not leak that the campaign exists, nor any of its items.
    expect(await res.text()).not.toContain(seeded.itemId);
  });

  it('a non-member of the org returns 403 on both endpoints', async () => {
    const outsider = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const store = await createStore(org.id);
    const seeded = await seedCampaign(org.id, store.id);

    const estimate = await post(
      `/v1/organizations/${org.id}/stores/${store.id}/marketplace-campaigns/${seeded.campaignId}/items/${seeded.itemId}/estimate`,
      ESTIMATE_BODY,
      outsider.accessToken,
    );
    expect(estimate.status).toBe(403);
    expect(((await estimate.json()) as { code: string }).code).toBe('FORBIDDEN');

    const targetMargin = await post(
      `/v1/organizations/${org.id}/stores/${store.id}/marketplace-campaigns/${seeded.campaignId}/target-margin`,
      TARGET_MARGIN_BODY,
      outsider.accessToken,
    );
    expect(targetMargin.status).toBe(403);
  });

  it('a request with no auth token returns 401 on both endpoints', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const seeded = await seedCampaign(org.id, store.id);

    const estimate = await post(
      `/v1/organizations/${org.id}/stores/${store.id}/marketplace-campaigns/${seeded.campaignId}/items/${seeded.itemId}/estimate`,
      ESTIMATE_BODY,
    );
    expect(estimate.status).toBe(401);

    const targetMargin = await post(
      `/v1/organizations/${org.id}/stores/${store.id}/marketplace-campaigns/${seeded.campaignId}/target-margin`,
      TARGET_MARGIN_BODY,
    );
    expect(targetMargin.status).toBe(401);
  });
});
