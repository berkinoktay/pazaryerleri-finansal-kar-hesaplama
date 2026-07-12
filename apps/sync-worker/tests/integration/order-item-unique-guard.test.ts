// order_items dedup: defense-in-depth partial UNIQUE guard.
//
// OrderItem dedup is enforced today only at the application layer (a
// platform_line_id-first findFirst before insert) plus the structural
// impossibility of concurrent double-processing (one active-slot sync lease,
// one webhook_event processing lease). This test deliberately BYPASSES that
// application layer and writes straight through Prisma to prove the partial
// unique index (order_items_order_platform_line_uniq in check-constraints.sql)
// makes a duplicate (order_id, platform_line_id) row impossible at the schema
// layer — the DB-layer safety belt against a future bug that would otherwise
// double-count a line's revenue/profit. Mirrors the fee-idempotency guard suite
// (order-fee-unique-guards.test.ts).
//
// Requires `pnpm db:push` / `pnpm db:test-setup` (chains apply-policies →
// check-constraints.sql) against the local Supabase before running — same
// prerequisite as every other integration suite.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import {
  createOrder,
  createOrganization,
  createStore,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

/** Prisma maps PG 23505 (unique violation) to P2002. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('code' in err && err.code === 'P2002') return true;
  return err instanceof Error && err.message.includes('23505');
}

async function buildOrder(): Promise<{ orderId: string; organizationId: string }> {
  const org = await createOrganization();
  const store = await createStore(org.id);
  const order = await createOrder(org.id, store.id);
  return { orderId: order.id, organizationId: org.id };
}

// commissionRate is the only required non-default OrderItem money column; the
// rest default to 0. platformLineId is the DB guard's second key column.
const ITEM = { quantity: 1, commissionRate: '10.00' } as const;

describe('order_items dedup unique guard', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('same (order_id, platform_line_id) is rejected by the DB (defense-in-depth)', async () => {
    const { orderId, organizationId } = await buildOrder();
    const line = {
      orderId,
      organizationId,
      platformLineId: BigInt(1),
      barcode: 'EAN13-DEDUP-001',
      ...ITEM,
    } as const;

    await prisma.orderItem.create({ data: line });

    await expect(prisma.orderItem.create({ data: line })).rejects.toSatisfy(isUniqueViolation);
  });

  it('a DIFFERENT platform_line_id on the same order lives (distinct lines)', async () => {
    const { orderId, organizationId } = await buildOrder();
    const base = { orderId, organizationId, barcode: 'EAN13-DEDUP-002', ...ITEM } as const;

    await prisma.orderItem.create({ data: { ...base, platformLineId: BigInt(1) } });
    await prisma.orderItem.create({ data: { ...base, platformLineId: BigInt(2) } });

    const rows = await prisma.orderItem.count({ where: { orderId } });
    expect(rows).toBe(2);
  });

  it('platform_line_id NULL rows are out of scope — multiple legitimate NULL lines coexist', async () => {
    const { orderId, organizationId } = await buildOrder();
    // The WHERE platform_line_id IS NOT NULL predicate leaves NULL (legacy /
    // unmapped) lines unconstrained: the same variant can legitimately span
    // multiple such lines, so a unique over NULLs would be wrong.
    const nullLine = { orderId, organizationId, platformLineId: null, ...ITEM } as const;

    await prisma.orderItem.create({ data: nullLine });
    await prisma.orderItem.create({ data: nullLine });

    const rows = await prisma.orderItem.count({ where: { orderId } });
    expect(rows).toBe(2);
  });
});
