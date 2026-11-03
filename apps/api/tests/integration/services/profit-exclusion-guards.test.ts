/**
 * Profit-exclusion DB guards (Faz 3E, Berkin 2026-11-03).
 *
 * An order whose cost missed its order day is excluded from profit
 * PERMANENTLY. Phase 3D had dropped the old freeze trigger (which also froze
 * the legacy profit columns); this phase re-introduces a narrower guard:
 *
 *   - reject_automatic_exclusion_change (trigger): once an AUTOMATIC exclusion
 *     reason (COST_DEADLINE_MISSED / LATE_UNCOSTED_ARRIVAL / LEGACY_BACKFILL)
 *     is stamped, it can never be cleared or re-pointed at another reason.
 *     Stamping an exclusion on an order that has none stays allowed -- the two
 *     writers and the backfill script do exactly that. A future, reversible
 *     user exclusion will carry its own reason and is not covered here.
 *   - orders_profit_exclusion_pair_check (CHECK): the stamp and its reason must
 *     be written together, on both INSERT and UPDATE.
 *
 * Assert style follows the house pattern (order-immutability.test.ts /
 * cost-snapshot-immutability.test.ts): match the rejection message so we prove
 * it was OUR guard (the trigger message, the constraint name), not a generic
 * error.
 */

import { randomUUID } from 'node:crypto';

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrder, createOrganization, createStore } from '../../helpers/factories';

describe('profit exclusion guards', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects clearing an automatic exclusion', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);

    // Stamping on an order that has none is allowed (OLD reason is NULL).
    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    // Clearing both columns trips the trigger (SQLSTATE 42501): an automatic
    // exclusion is permanent.
    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: { profitExcludedAt: null, profitExclusionReason: null },
      }),
    ).rejects.toThrow(/automatic profit exclusion is permanent/);
  });

  it('rejects changing the reason of an automatic exclusion', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);

    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    // Re-pointing the reason at another automatic reason is just as forbidden.
    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: { profitExclusionReason: 'LATE_UNCOSTED_ARRIVAL' },
      }),
    ).rejects.toThrow(/automatic profit exclusion is permanent/);
  });

  it('stamps an exclusion on an order that has none', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);

    const stampedAt = new Date();
    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: stampedAt, profitExclusionReason: 'LATE_UNCOSTED_ARRIVAL' },
    });

    const reread = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reread.profitExcludedAt).toEqual(stampedAt);
    expect(reread.profitExclusionReason).toBe('LATE_UNCOSTED_ARRIVAL');
  });

  it('still rejects an exclusion stamp without a reason', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);

    // Stamp without a reason violates the pair check (SQLSTATE 23514). The
    // trigger passes it through (OLD reason is NULL), the constraint catches it.
    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: { profitExcludedAt: new Date() },
      }),
    ).rejects.toThrow(/orders_profit_exclusion_pair_check/);
  });

  it('rejects an exclusion stamp without a reason on insert', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);

    // Inserting an order already stamped excluded but with a null reason violates the
    // surviving pair check (SQLSTATE 23514) -- the same guard the update path hits.
    await expect(
      prisma.order.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          platformOrderId: `test-order-${randomUUID().slice(0, 8)}`,
          orderDate: new Date(),
          status: 'DELIVERED',
          profitExcludedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/orders_profit_exclusion_pair_check/);
  });

  it('leaves status and cargo updates on an excluded order free', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);

    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    // An UPDATE that touches neither exclusion column never fires the trigger,
    // so ordinary status / cargo progress on an excluded order stays free.
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: 'SHIPPED', cargoProviderName: 'Trendyol Express' },
    });

    expect(updated.status).toBe('SHIPPED');
    expect(updated.cargoProviderName).toBe('Trendyol Express');
    expect(updated.profitExclusionReason).toBe('COST_DEADLINE_MISSED');
  });
});
