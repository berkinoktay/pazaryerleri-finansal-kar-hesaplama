/**
 * Regression: disconnecting a store must cascade-delete its store-scoped cost
 * profiles even when those profiles are referenced by variant links and by
 * order-item cost snapshot components.
 *
 * Cost profiles became store-scoped (Store --Cascade--> CostProfile). Their
 * child FKs (product_variant_cost_profiles.profile_id and
 * order_item_cost_snapshot_components.profile_id) were `onDelete: Restrict`,
 * which is checked immediately and deadlocked the store-delete cascade — so a
 * store that had ANY real cost data could never be disconnected (P2003 → 422).
 * The FKs are now `onDelete: Cascade`; this test locks that in.
 */

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { disconnect } from '@/services/store.service';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createOrder,
  createOrderItem,
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

  it('disconnects a store that has a cost profile referenced by a variant link and an order snapshot', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    const profile = await createCostProfile(org.id, { storeId: store.id });

    // Variant link: attach the profile to a store variant.
    const product = await createProduct(org.id, store.id);
    const variant = await createProductVariant(org.id, store.id, product.id);
    await prisma.productVariantCostProfile.create({
      data: { organizationId: org.id, productVariantId: variant.id, profileId: profile.id },
    });

    // Order snapshot component: an order line whose cost breakdown references
    // the profile (captured during order sync in production).
    const order = await createOrder(org.id, store.id);
    const item = await createOrderItem(order.id, org.id, { productVariantId: variant.id });
    await prisma.orderItemCostSnapshotComponent.create({
      data: {
        orderItemId: item.id,
        organizationId: org.id,
        profileId: profile.id,
        profileName: profile.name,
        profileType: profile.type,
        currency: 'TRY',
        fxRateMode: 'MANUAL',
        fxRateUsed: new Decimal('1'),
        fxRateSource: 'TEST',
      },
    });

    // Previously this threw (RESTRICT deadlock); it must now succeed.
    await expect(disconnect(org.id, store.id)).resolves.toBeUndefined();

    // The store and every dependent row are gone.
    expect(await prisma.store.findUnique({ where: { id: store.id } })).toBeNull();
    expect(await prisma.costProfile.count({ where: { storeId: store.id } })).toBe(0);
    expect(await prisma.productVariantCostProfile.count({ where: { profileId: profile.id } })).toBe(
      0,
    );
    expect(
      await prisma.orderItemCostSnapshotComponent.count({ where: { profileId: profile.id } }),
    ).toBe(0);
  });
});
