// Integration test for fetchCostAggregates, the per-variant sum of active cost profiles.
// It pins the variant store predicate (pv.store_id): route callers narrow the variant ids
// by store before they call the aggregate, so no route test can see that predicate
// removed. This direct call is its only pin.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { fetchCostAggregates } from '@/services/cost-aggregate.service';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../helpers/factories';

describe('fetchCostAggregates', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('a variant of another store is absent from the aggregate', async () => {
    const orgA = await createOrganization();
    const storeA1 = await createStore(orgA.id);
    const storeA2 = await createStore(orgA.id);
    const product = await createProduct(orgA.id, storeA2.id);
    const variantOfA2 = (await createProductVariant(orgA.id, storeA2.id, product.id)).id;
    const profile = await createCostProfile(orgA.id, {
      storeId: storeA2.id,
      amountGross: '40.00',
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId: orgA.id, productVariantId: variantOfA2, profileId: profile.id },
    });

    const other = await fetchCostAggregates({
      organizationId: orgA.id,
      storeId: storeA1.id,
      variantIds: [variantOfA2],
    });
    expect(other.has(variantOfA2)).toBe(false);

    // Positive control: the same variant under its own store.
    const own = await fetchCostAggregates({
      organizationId: orgA.id,
      storeId: storeA2.id,
      variantIds: [variantOfA2],
    });
    expect(own.get(variantOfA2)).toMatchObject({
      currentCostTry: '40.00',
      profileCount: 1,
      costStatus: 'OK',
    });
  });
});
