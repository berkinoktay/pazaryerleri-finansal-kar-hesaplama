/**
 * Profit-exclusion DB guards (design 2026-10-29 profit-engine section 8.3).
 *
 * Exclusion is no longer permanent. The old freeze contract
 * (reject_profit_freeze_breach trigger + orders_profit_freeze_xor_check)
 * made exclusion a one-way door and forbade excluding a calculated order;
 * both were dropped in this phase. What remains is the pair check
 * (orders_profit_exclusion_pair_check): the stamp and its reason must be
 * written and cleared together.
 *
 * Assert style follows the house pattern (order-immutability.test.ts): match
 * the constraint name in the rejection so we prove it was OUR check, not a
 * generic error.
 */

import { Prisma, prisma } from '@pazarsync/db';
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

  it('clears an exclusion stamp together with its reason', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);

    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'COST_DEADLINE_MISSED' },
    });

    // Clearing both columns in one update used to be rejected by the freeze
    // trigger ("profit exclusion is permanent"); it must now succeed.
    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: null, profitExclusionReason: null },
    });

    const reread = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reread.profitExcludedAt).toBeNull();
    expect(reread.profitExclusionReason).toBeNull();
  });

  it('excludes and re-includes an order that already carries a legacy estimate', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);

    await prisma.order.update({
      where: { id: order.id },
      data: { estimatedNetProfit: new Prisma.Decimal('42.00') },
    });

    // Stamping an exclusion on a calculated order used to trip both the xor
    // check (estimate + stamp coexisting) and the trigger ("calculated order
    // cannot be excluded"); both are gone, so it must succeed.
    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: new Date(), profitExclusionReason: 'LEGACY_BACKFILL' },
    });

    // Re-including the order (clearing the stamp) must also succeed.
    await prisma.order.update({
      where: { id: order.id },
      data: { profitExcludedAt: null, profitExclusionReason: null },
    });

    const reread = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reread.profitExcludedAt).toBeNull();
    expect(reread.profitExclusionReason).toBeNull();
    expect(reread.estimatedNetProfit).not.toBeNull();
  });

  it('still rejects an exclusion stamp without a reason', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const order = await createOrder(org.id, store.id);

    // Stamp without a reason violates the surviving pair check (SQLSTATE 23514).
    await expect(
      prisma.order.update({
        where: { id: order.id },
        data: { profitExcludedAt: new Date() },
      }),
    ).rejects.toThrow(/orders_profit_exclusion_pair_check/);
  });
});
