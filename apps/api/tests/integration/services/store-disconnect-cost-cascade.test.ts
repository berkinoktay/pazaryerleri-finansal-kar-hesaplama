/**
 * Regression: disconnecting a store must cascade-delete its store-scoped cost
 * profiles even when those profiles are referenced by variant links.
 *
 * Cost profiles became store-scoped (Store --Cascade--> CostProfile). Their
 * child FK (product_variant_cost_profiles.profile_id) was `onDelete: Restrict`,
 * which is checked immediately and deadlocked the store-delete cascade — so a
 * store that had ANY real cost data could never be disconnected (P2003 → 422).
 * The FK is now `onDelete: Cascade`; this test locks that in.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { disconnect } from '@/services/store.service';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../helpers/factories';

describe('store disconnect — cost-profile cascade', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('disconnects a store that has a cost profile referenced by a variant link', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const profile = await createCostProfile(org.id, { storeId: store.id });

    // Variant link: attach the profile to a store variant.
    const product = await createProduct(org.id, store.id);
    const variant = await createProductVariant(org.id, store.id, product.id);
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, productVariantId: variant.id, profileId: profile.id },
    });

    // Previously this threw (RESTRICT deadlock); it must now succeed.
    await expect(disconnect(org.id, store.id)).resolves.toBeUndefined();

    // The store and every dependent row are gone.
    expect(await prisma.store.findUnique({ where: { id: store.id } })).toBeNull();
    expect(await prisma.costProfile.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.productVariantCostProfile.count({ where: { profileId: profile.id } })).toBe(
      0,
    );
  });
});
