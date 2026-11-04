import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createFinanceRecord,
  createMembership,
  createOrder,
  createOrderClaim,
  createOrderItem,
  createOrganization,
  createProfitLine,
  createStore,
} from '../../helpers/factories';

async function createBareClaim(orgId: string, storeId: string): Promise<{ claimId: string }> {
  const order = await createOrder(orgId, storeId);
  const claim = await createOrderClaim(orgId, storeId, order.id);
  return { claimId: claim.id };
}

/**
 * Seeds one in-period SALE_RETURN line dated by a SETTLEMENT record, for the
 * summary's refund-deduction KPI.
 */
async function seedSaleReturn(orgId: string, storeId: string, gross: string): Promise<void> {
  const order = await createOrder(orgId, storeId);
  const orderItem = await createOrderItem(order.id, orgId, { quantity: 1 });
  const recordId = `rec-${randomUUID().slice(0, 8)}`;
  await createFinanceRecord(orgId, storeId, { recordId, transactionDate: new Date() });
  await createProfitLine(order.id, orgId, storeId, {
    orderItemId: orderItem.id,
    type: 'SALE_RETURN',
    certainty: 'ACTUAL',
    source: 'MARKETPLACE_RECORD',
    amountGross: gross,
    externalRecordId: recordId,
  });
}

/**
 * Multi-tenancy invariant: a member of org A MUST NOT see claims that belong
 * to org B — even by guessing B's storeId. 403 on foreign org in the URL;
 * 404 (existence non-disclosure) on a foreign storeId under their own org.
 */
describe('Claims — tenant isolation', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('LIST: 403 when caller targets an org they do not belong to', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const res = await app.request(`/v1/organizations/${orgB.id}/stores/${storeB.id}/claims`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(403);
  });

  it('LIST: 404 when caller targets their own org but a sibling org storeId', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);
    await createBareClaim(orgB.id, storeB.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeB.id}/claims`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(404); // existence non-disclosure
  });

  it('LIST: a member of two orgs only sees claims for the org they query', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    await createMembership(orgB.id, user.id);
    const storeA = await createStore(orgA.id);
    const storeB = await createStore(orgB.id);
    const claimA = await createBareClaim(orgA.id, storeA.id);
    await createBareClaim(orgB.id, storeB.id);

    const res = await app.request(`/v1/organizations/${orgA.id}/stores/${storeA.id}/claims`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[]; counts: { all: number } };
    expect(body.data.map((c) => c.id)).toEqual([claimA.claimId]);
    expect(body.counts.all).toBe(1);
  });

  it('SUMMARY: 403 on foreign org, 404 on foreign storeId under own org', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    const foreignOrg = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/claims/summary`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(foreignOrg.status).toBe(403);

    const foreignStore = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/claims/summary`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(foreignStore.status).toBe(404);
  });

  it('ignores lines and records of another organization', async () => {
    const user = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, user.id);
    const storeA = await createStore(orgA.id);
    const orgB = await createOrganization();
    const storeB = await createStore(orgB.id);

    await seedSaleReturn(orgA.id, storeA.id, '50.00');
    // Org B's same-dated return lines and records must never reach org A.
    await seedSaleReturn(orgB.id, storeB.id, '120.00');

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeA.id}/claims/summary`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      refundDeductionGross: '50.00',
      commissionRefundGross: '0.00',
      costReturnGross: '0.00',
      netImpactGross: '-50.00',
    });
  });
});
