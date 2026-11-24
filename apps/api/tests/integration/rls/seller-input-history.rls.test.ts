import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * Seller-input history logs (same-day edit window): cost_link_removals and
 * variant_desi_changes. Both are written only by triggers on the service
 * connection (RLS-bypassed); authenticated clients can only SELECT, and each
 * policy mirrors its parent table:
 *   - cost_link_removals mirrors product_variant_cost_profiles:
 *     is_org_member(organization_id).
 *   - variant_desi_changes mirrors product_variants: can_access_store(store_id),
 *     so a MEMBER without a store grant sees none of that store's rows.
 * Rows are seeded directly through Prisma so the test exercises the policy
 * alone, not the triggers.
 */

const ONE_DAY_MS = 86_400_000;

interface TenantVariant {
  readonly organizationId: string;
  readonly storeId: string;
  readonly variantId: string;
}

async function seedVariant(organizationId: string): Promise<TenantVariant> {
  const store = await createStore(organizationId);
  const product = await createProduct(organizationId, store.id);
  const variant = await createProductVariant(organizationId, store.id, product.id);
  return { organizationId, storeId: store.id, variantId: variant.id };
}

async function seedRemoval(tenant: TenantVariant): Promise<void> {
  const profile = await createCostProfile(tenant.organizationId, { storeId: tenant.storeId });
  await prisma.costLinkRemoval.create({
    data: {
      organizationId: tenant.organizationId,
      productVariantId: tenant.variantId,
      profileId: profile.id,
      attachedAt: new Date(Date.now() - ONE_DAY_MS),
      detachedAt: new Date(),
    },
  });
}

async function seedDesiChange(tenant: TenantVariant): Promise<void> {
  await prisma.variantDesiChange.create({
    data: {
      organizationId: tenant.organizationId,
      storeId: tenant.storeId,
      productVariantId: tenant.variantId,
      changedAt: new Date(),
      overrideChanged: true,
      syncedChanged: false,
      oldOverride: null,
      newOverride: '2.50',
      oldSynced: null,
      newSynced: null,
    },
  });
}

describe('RLS — seller-input history logs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only cost_link_removals rows from own org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [tenantA, tenantB] = await Promise.all([seedVariant(orgA.id), seedVariant(orgB.id)]);
    await Promise.all([seedRemoval(tenantA), seedRemoval(tenantB)]);

    const { data, error } = await client
      .from('cost_link_removals')
      .select('organization_id,product_variant_id');

    expect(error).toBeNull();
    // Positive control: the own-org row is visible; the sibling org's row is not.
    expect(data).toEqual([{ organization_id: orgA.id, product_variant_id: tenantA.variantId }]);
  });

  it('member sees only variant_desi_changes rows from own org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [tenantA, tenantB] = await Promise.all([seedVariant(orgA.id), seedVariant(orgB.id)]);
    await Promise.all([seedDesiChange(tenantA), seedDesiChange(tenantB)]);

    const { data, error } = await client
      .from('variant_desi_changes')
      .select('organization_id,product_variant_id');

    expect(error).toBeNull();
    // Positive control: the own-org row is visible; the sibling org's row is not.
    expect(data).toEqual([{ organization_id: orgA.id, product_variant_id: tenantA.variantId }]);
  });

  it('MEMBER without a store grant sees no variant_desi_changes row of that store', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    const membership = await createMembership(org.id, user.id, 'MEMBER');
    const tenant = await seedVariant(org.id);
    await seedDesiChange(tenant);

    const before = await client.from('variant_desi_changes').select('product_variant_id');
    expect(before.error).toBeNull();
    expect(before.data).toEqual([]);

    // Positive control: once the store is granted, the same row is visible.
    await createMemberStoreAccess(org.id, membership.id, tenant.storeId);
    const after = await client.from('variant_desi_changes').select('product_variant_id');
    expect(after.error).toBeNull();
    expect(after.data).toEqual([{ product_variant_id: tenant.variantId }]);
  });
});
