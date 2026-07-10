/**
 * Store-access isolation for the by-id cost-profile routes (store-scoped
 * boundary, PR-B/C).
 *
 * Cost profiles are store-scoped: each belongs to exactly one store. A MEMBER
 * granted only store A must not read OR mutate a profile that lives in store B,
 * even though both stores belong to the same org. Per SECURITY.md §3
 * (non-disclosure), an ungranted-store profile is indistinguishable from a
 * missing one → 404 on the profile routes, 422 on the variant route (same as a
 * cross-org variant). OWNER/ADMIN see every store in their org and are not
 * narrowed.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

async function seedProfile(orgId: string, storeId: string, name: string) {
  return prisma.costProfile.create({
    data: {
      organizationId: orgId,
      storeId,
      name,
      type: 'COGS',
      amountGross: new Decimal('25.50'),
      currency: 'TRY',
      vatRate: 18,
      fxRateMode: 'AUTO',
    },
  });
}

async function seedVariant(orgId: string, storeId: string) {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `main-${randomUUID().slice(0, 8)}`,
      title: 'Test Product',
    },
  });
  return prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: randomUUID().slice(0, 13),
      stockCode: `SKU-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('199.99'),
      listPrice: new Decimal('249.99'),
    },
  });
}

describe('Store-access isolation — by-id cost-profile routes', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // A MEMBER granted only store A, plus a profile in store A (granted) and one
  // in store B (ungranted), and a store-B variant.
  async function setupMemberGrantedStoreA() {
    const member = await createAuthenticatedTestUser();
    const org = await createOrganization();
    const membership = await createMembership(org.id, member.id, 'MEMBER');
    const storeA = await createStore(org.id);
    const storeB = await createStore(org.id);
    await createMemberStoreAccess(org.id, membership.id, storeA.id);

    const profileA = await seedProfile(org.id, storeA.id, 'Store A COGS');
    const profileB = await seedProfile(org.id, storeB.id, 'Store B COGS');
    const variantB = await seedVariant(org.id, storeB.id);

    return { member, org, storeA, storeB, profileA, profileB, variantB };
  }

  // ─── READ by id — GET / versions / attached-variants ───────────────────────

  it('MEMBER granted store A gets 404 reading a store B profile by id', async () => {
    const { member, org, profileB } = await setupMemberGrantedStoreA();

    const res = await app.request(`/v1/organizations/${org.id}/cost-profiles/${profileB.id}`, {
      headers: { Authorization: bearer(member.accessToken) },
    });
    expect(res.status).toBe(404);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_NOT_FOUND');
  });

  it('MEMBER granted store A CAN read a store A profile by id', async () => {
    const { member, org, profileA } = await setupMemberGrantedStoreA();

    const res = await app.request(`/v1/organizations/${org.id}/cost-profiles/${profileA.id}`, {
      headers: { Authorization: bearer(member.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(profileA.id);
  });

  it('MEMBER granted store A gets 404 listing a store B profile versions', async () => {
    const { member, org, profileB } = await setupMemberGrantedStoreA();

    const res = await app.request(
      `/v1/organizations/${org.id}/cost-profiles/${profileB.id}/versions`,
      { headers: { Authorization: bearer(member.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  it('MEMBER granted store A gets 404 listing a store B profile attached-variants', async () => {
    const { member, org, profileB } = await setupMemberGrantedStoreA();

    const res = await app.request(
      `/v1/organizations/${org.id}/cost-profiles/${profileB.id}/attached-variants`,
      { headers: { Authorization: bearer(member.accessToken) } },
    );
    expect(res.status).toBe(404);
  });

  // ─── WRITE by id — PATCH / archive ─────────────────────────────────────────

  it('MEMBER granted store A gets 404 patching a store B profile', async () => {
    const { member, org, profileB } = await setupMemberGrantedStoreA();

    const res = await app.request(`/v1/organizations/${org.id}/cost-profiles/${profileB.id}`, {
      method: 'PATCH',
      headers: { Authorization: bearer(member.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hijacked', amountGross: '999.00' }),
    });
    expect(res.status).toBe(404);

    // The store B profile is untouched.
    const row = await prisma.costProfile.findUnique({ where: { id: profileB.id } });
    expect(row?.name).toBe('Store B COGS');
  });

  it('MEMBER granted store A CAN patch a store A profile', async () => {
    const { member, org, profileA } = await setupMemberGrantedStoreA();

    const res = await app.request(`/v1/organizations/${org.id}/cost-profiles/${profileA.id}`, {
      method: 'PATCH',
      headers: { Authorization: bearer(member.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Store A Updated' }),
    });
    expect(res.status).toBe(200);
  });

  it('MEMBER granted store A gets 404 archiving a store B profile', async () => {
    const { member, org, profileB } = await setupMemberGrantedStoreA();

    const res = await app.request(
      `/v1/organizations/${org.id}/cost-profiles/${profileB.id}/archive`,
      { method: 'POST', headers: { Authorization: bearer(member.accessToken) } },
    );
    expect(res.status).toBe(404);

    // Not archived.
    const row = await prisma.costProfile.findUnique({ where: { id: profileB.id } });
    expect(row?.archivedAt).toBeNull();
  });

  it('MEMBER granted store A gets 404 restoring a store B profile', async () => {
    const { member, org, profileB } = await setupMemberGrantedStoreA();

    // Archive it first (as if an OWNER had), then confirm the MEMBER can't
    // un-archive an ungranted store's profile.
    await prisma.costProfile.update({
      where: { id: profileB.id },
      data: { archivedAt: new Date() },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/cost-profiles/${profileB.id}/restore`,
      { method: 'POST', headers: { Authorization: bearer(member.accessToken) } },
    );
    expect(res.status).toBe(404);

    // Still archived — nothing changed.
    const row = await prisma.costProfile.findUnique({ where: { id: profileB.id } });
    expect(row?.archivedAt).not.toBeNull();
  });

  // ─── Variant → cost-profiles read ──────────────────────────────────────────

  it('MEMBER granted store A gets 422 reading a store B variant cost-profiles', async () => {
    const { member, org, variantB } = await setupMemberGrantedStoreA();

    const res = await app.request(
      `/v1/organizations/${org.id}/variants/${variantB.id}/cost-profiles`,
      { headers: { Authorization: bearer(member.accessToken) } },
    );
    expect(res.status).toBe(422);
    const err = (await res.json()) as { code: string };
    expect(err.code).toBe('COST_PROFILE_VARIANT_ORG_MISMATCH');
  });

  // ─── OWNER is not narrowed ─────────────────────────────────────────────────

  it('OWNER reads a profile in any store of their org (not store-narrowed)', async () => {
    const owner = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, owner.id, 'OWNER');
    const storeB = await createStore(org.id);
    // OWNER holds no member_store_access grants, yet sees every store by role.
    const profileB = await seedProfile(org.id, storeB.id, 'Store B COGS');

    const res = await app.request(`/v1/organizations/${org.id}/cost-profiles/${profileB.id}`, {
      headers: { Authorization: bearer(owner.accessToken) },
    });
    expect(res.status).toBe(200);
  });
});
