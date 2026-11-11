/**
 * Order rows carry no write-once lock.
 *
 * PR-9's write-once trigger (`orders_estimated_net_profit_write_once`) was
 * removed on 2026-06-13 (the cargo estimate refines as better data arrives),
 * and the estimated_net_profit column itself was dropped by the profit engine
 * rebuild (migration 20261111104912; profit lives in order_profit_statements).
 * What remains pinned here: a plain order UPDATE goes through.
 *
 * Guarantees tested elsewhere:
 *   - Profit exclusion stamp/reason pair → services/profit-exclusion-guards.test.ts
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, prisma, truncateAll } from '../helpers/db';
import { createOrder, createOrganization, createStore } from '../helpers/factories';

async function buildOrder(): Promise<{ orderId: string }> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  const order = await createOrder(org.id, store.id);
  return { orderId: order.id };
}

describe('Order rows are updatable (no write-once lock)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('allows a plain order UPDATE', async () => {
    const { orderId } = await buildOrder();

    await expect(
      prisma.order.update({
        where: { id: orderId },
        data: { status: 'DELIVERED' },
      }),
    ).resolves.toBeDefined();
  });
});
