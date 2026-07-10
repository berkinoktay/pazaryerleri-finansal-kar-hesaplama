import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * expenses: store_id is nullable. Org-level expenses (store_id NULL) follow org
 * membership; store-attributed expenses (store_id set) additionally follow store
 * access. The policy is `is_org_member(organization_id) AND (store_id IS NULL OR
 * can_access_store(store_id))` — the is_org_member conjunct is the cross-org fix:
 * store_id is a plain FK (references stores.id, not a composite (id, org)), so a
 * row could carry organization_id = A while store_id points at a store in org B;
 * without the org check a member of org B would read org A's expense amount.
 */
async function seedExpense(organizationId: string, storeId: string | null) {
  return prisma.expense.create({
    data: {
      organizationId,
      storeId,
      category: 'OTHER',
      amount: new Decimal('100.00'),
      date: new Date('2026-06-01'),
    },
  });
}

describe('RLS — expenses', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('OWNER sees own-org expenses (org-level + store-level), not a sibling org', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);

    const orgLevelA = await seedExpense(orgA.id, null);
    const storeLevelA = await seedExpense(orgA.id, storeA.id);
    await seedExpense(orgB.id, null); // sibling org-level
    await seedExpense(orgB.id, storeB.id); // sibling store-level

    const { data, error } = await client.from('expenses').select('id');

    expect(error).toBeNull();
    expect(data?.map((e) => e.id).sort()).toEqual([orgLevelA.id, storeLevelA.id].sort());
  });

  it('MEMBER granted only store A sees org-level + store-A expenses, not store B', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    const membership = await createMembership(org.id, user.id, 'MEMBER');
    const [storeA, storeB] = await Promise.all([createStore(org.id), createStore(org.id)]);
    await createMemberStoreAccess(org.id, membership.id, storeA.id);

    const orgLevel = await seedExpense(org.id, null);
    const storeAExpense = await seedExpense(org.id, storeA.id);
    await seedExpense(org.id, storeB.id); // ungranted store — must stay hidden

    const { data, error } = await client.from('expenses').select('id');

    expect(error).toBeNull();
    expect(data?.map((e) => e.id).sort()).toEqual([orgLevel.id, storeAExpense.id].sort());
  });

  it('cross-org store pointer: an org-A expense whose store is in org B is invisible to org B', async () => {
    // orgB's OWNER is the reader.
    const { user: userB, client } = await createRlsScopedClient();
    const userA = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const storeB = await createStore(orgB.id);

    // A malformed row (only reachable via a future writer bug): organization_id
    // is org A, but store_id points at org B's store. can_access_store(storeB)
    // would be TRUE for org B's owner — the is_org_member(org A) conjunct is what
    // keeps this org-A row hidden from org B.
    await seedExpense(orgA.id, storeB.id);

    const { data, error } = await client.from('expenses').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
