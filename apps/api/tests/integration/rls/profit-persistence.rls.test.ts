import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrderItem,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * Profit engine persistence (rebuild, phases 3A + 3B). The five tables are
 * written only by the profit writer / sync producers (postgres role) and each
 * carries a store_id the writer stamps from the parent order (or the store).
 * Every table has exactly one policy,
 * `<table>_org_member_read FOR SELECT USING (can_access_store(store_id))`, and
 * NO write policy, so client writes are default-deny.
 *
 * The tests assert observable behavior with the order-claims two-org pattern:
 * own-org rows visible, sibling-org rows invisible (full-table AND by-id), a
 * MEMBER without a store grant sees nothing, and INSERT/UPDATE/DELETE from an
 * authenticated client are denied.
 */

interface SeededProfitStack {
  orderId: string;
  orderItemId: string;
  profitLineId: string;
  allocationId: string;
  statementId: string;
  financeRecordId: string;
  recomputeRequestId: string;
}

/**
 * Seed one order + item and one row in each of the five profit tables for the
 * given org/store, via Prisma (postgres role, bypasses RLS). There are no
 * shared factories for these tables yet; the values are realistic but minimal
 * — the RLS tests only prove tenant isolation, not business correctness.
 */
async function seedProfitStack(
  organizationId: string,
  storeId: string,
): Promise<SeededProfitStack> {
  const order = await createOrder(organizationId, storeId);
  const orderItem = await createOrderItem(order.id, organizationId);

  const profitLine = await prisma.profitLine.create({
    data: {
      organizationId,
      storeId,
      orderId: order.id,
      orderItemId: orderItem.id,
      type: 'SALE',
      level: 'ITEM',
      certainty: 'ESTIMATE',
      source: 'RULE',
      amountGross: '100.00',
      amountVat: '16.67',
      originalCurrency: 'TRY',
      originalGross: '100.00',
      originalVat: '16.67',
      fxRate: '1',
      fxSource: 'NATIVE',
      inputs: {},
      engineVersion: 1,
    },
  });

  const allocation = await prisma.profitLineAllocation.create({
    data: {
      organizationId,
      storeId,
      profitLineId: profitLine.id,
      orderItemId: orderItem.id,
      amountGross: '100.00',
      amountVat: '16.67',
      basis: 'STANDALONE_AMOUNT',
    },
  });

  const statement = await prisma.orderProfitStatement.create({
    data: {
      organizationId,
      storeId,
      orderId: order.id,
      view: 'ESTIMATE',
      status: 'ESTIMATED',
      saleGross: '100.00',
      costGross: '60.00',
      vatOutput: '16.67',
      vatInput: '10.00',
      vatNet: '6.67',
      vatEffective: '6.67',
      stoppageGross: '0.00',
      stoppageIncluded: true,
      issues: [],
      settingsSnapshot: {},
      engineVersion: 1,
      contentHash: 'test',
      computedAt: new Date(),
    },
  });

  const financeRecord = await prisma.marketplaceFinanceRecord.create({
    data: {
      organizationId,
      storeId,
      platform: 'TRENDYOL',
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: `rec-${randomUUID()}`,
      payload: {},
      fetchedAt: new Date(),
    },
  });

  const recomputeRequest = await prisma.profitRecomputeRequest.create({
    data: {
      organizationId,
      storeId,
      orderId: order.id,
      reason: 'ORDER_CHANGED',
    },
  });

  return {
    orderId: order.id,
    orderItemId: orderItem.id,
    profitLineId: profitLine.id,
    allocationId: allocation.id,
    statementId: statement.id,
    financeRecordId: financeRecord.id,
    recomputeRequestId: recomputeRequest.id,
  };
}

describe('RLS — profit engine persistence', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member sees only own-org rows across all five profit tables', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    const [stackA] = await Promise.all([
      seedProfitStack(orgA.id, storeA.id),
      seedProfitStack(orgB.id, storeB.id),
    ]);

    const [lines, allocations, statements, finance, queue] = await Promise.all([
      client.from('profit_lines').select('id,type'),
      client.from('profit_line_allocations').select('id,basis'),
      client.from('order_profit_statements').select('id,view'),
      client.from('marketplace_finance_records').select('id,transaction_type'),
      client.from('profit_recompute_queue').select('id,reason'),
    ]);

    expect(lines.error).toBeNull();
    expect(lines.data?.map((r) => r.id)).toEqual([stackA.profitLineId]);
    expect(allocations.error).toBeNull();
    expect(allocations.data?.map((r) => r.id)).toEqual([stackA.allocationId]);
    expect(statements.error).toBeNull();
    expect(statements.data?.map((r) => r.id)).toEqual([stackA.statementId]);
    expect(finance.error).toBeNull();
    expect(finance.data?.map((r) => r.id)).toEqual([stackA.financeRecordId]);
    expect(queue.error).toBeNull();
    expect(queue.data?.map((r) => r.id)).toEqual([stackA.recomputeRequestId]);
  });

  it('member sees zero sibling-org rows even when querying their ids directly', async () => {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    const [, stackB] = await Promise.all([
      seedProfitStack(orgA.id, storeA.id),
      seedProfitStack(orgB.id, storeB.id),
    ]);

    const [lines, allocations, statements, finance, queue] = await Promise.all([
      client.from('profit_lines').select('id').eq('id', stackB.profitLineId),
      client.from('profit_line_allocations').select('id').eq('id', stackB.allocationId),
      client.from('order_profit_statements').select('id').eq('id', stackB.statementId),
      client.from('marketplace_finance_records').select('id').eq('id', stackB.financeRecordId),
      client.from('profit_recompute_queue').select('id').eq('id', stackB.recomputeRequestId),
    ]);

    expect(lines.error).toBeNull();
    expect(lines.data).toEqual([]);
    expect(allocations.error).toBeNull();
    expect(allocations.data).toEqual([]);
    expect(statements.error).toBeNull();
    expect(statements.data).toEqual([]);
    expect(finance.error).toBeNull();
    expect(finance.data).toEqual([]);
    expect(queue.error).toBeNull();
    expect(queue.data).toEqual([]);
  });

  it('MEMBER without a store grant sees none of the five tables', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'MEMBER');
    const store = await createStore(org.id);
    await seedProfitStack(org.id, store.id);

    const [lines, allocations, statements, finance, queue] = await Promise.all([
      client.from('profit_lines').select('id'),
      client.from('profit_line_allocations').select('id'),
      client.from('order_profit_statements').select('id'),
      client.from('marketplace_finance_records').select('id'),
      client.from('profit_recompute_queue').select('id'),
    ]);

    expect(lines.error).toBeNull();
    expect(lines.data).toEqual([]);
    expect(allocations.error).toBeNull();
    expect(allocations.data).toEqual([]);
    expect(statements.error).toBeNull();
    expect(statements.data).toEqual([]);
    expect(finance.error).toBeNull();
    expect(finance.data).toEqual([]);
    expect(queue.error).toBeNull();
    expect(queue.data).toEqual([]);
  });

  it('authenticated client cannot write profit_lines (default-deny)', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const stack = await seedProfitStack(org.id, store.id);

    const insert = await client.from('profit_lines').insert({
      organization_id: org.id,
      store_id: store.id,
      order_id: stack.orderId,
      order_item_id: stack.orderItemId,
      type: 'SALE',
      level: 'ITEM',
      certainty: 'ESTIMATE',
      source: 'RULE',
      amount_gross: '1.00',
      amount_vat: '0.17',
      original_currency: 'TRY',
      original_gross: '1.00',
      original_vat: '0.17',
      fx_rate: '1',
      fx_source: 'NATIVE',
      inputs: {},
      engine_version: 1,
    });
    expect(insert.error).not.toBeNull();

    const update = await client
      .from('profit_lines')
      .update({ engine_version: 2 })
      .eq('id', stack.profitLineId)
      .select();
    if (update.error === null) expect(update.data).toEqual([]);

    const remove = await client.from('profit_lines').delete().eq('id', stack.profitLineId).select();
    if (remove.error === null) expect(remove.data).toEqual([]);
  });

  it('authenticated client cannot write profit_line_allocations (default-deny)', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const stack = await seedProfitStack(org.id, store.id);

    const insert = await client.from('profit_line_allocations').insert({
      organization_id: org.id,
      store_id: store.id,
      profit_line_id: stack.profitLineId,
      order_item_id: stack.orderItemId,
      amount_gross: '1.00',
      amount_vat: '0.17',
      basis: 'STANDALONE_AMOUNT',
    });
    expect(insert.error).not.toBeNull();

    const update = await client
      .from('profit_line_allocations')
      .update({ amount_gross: '2.00' })
      .eq('id', stack.allocationId)
      .select();
    if (update.error === null) expect(update.data).toEqual([]);

    const remove = await client
      .from('profit_line_allocations')
      .delete()
      .eq('id', stack.allocationId)
      .select();
    if (remove.error === null) expect(remove.data).toEqual([]);
  });

  it('authenticated client cannot write order_profit_statements (default-deny)', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const stack = await seedProfitStack(org.id, store.id);

    const insert = await client.from('order_profit_statements').insert({
      organization_id: org.id,
      store_id: store.id,
      order_id: stack.orderId,
      view: 'BEST_KNOWN',
      status: 'ESTIMATED',
      sale_gross: '1.00',
      cost_gross: '0.00',
      vat_output: '0.00',
      vat_input: '0.00',
      vat_net: '0.00',
      vat_effective: '0.00',
      stoppage_gross: '0.00',
      stoppage_included: true,
      issues: [],
      settings_snapshot: {},
      engine_version: 1,
      content_hash: 'insert-attempt',
      computed_at: new Date().toISOString(),
    });
    expect(insert.error).not.toBeNull();

    const update = await client
      .from('order_profit_statements')
      .update({ content_hash: 'tampered' })
      .eq('id', stack.statementId)
      .select();
    if (update.error === null) expect(update.data).toEqual([]);

    const remove = await client
      .from('order_profit_statements')
      .delete()
      .eq('id', stack.statementId)
      .select();
    if (remove.error === null) expect(remove.data).toEqual([]);
  });

  it('authenticated client cannot write marketplace_finance_records (default-deny)', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const stack = await seedProfitStack(org.id, store.id);

    const insert = await client.from('marketplace_finance_records').insert({
      organization_id: org.id,
      store_id: store.id,
      platform: 'TRENDYOL',
      family: 'SETTLEMENT',
      transaction_type: 'Sale',
      record_id: `rec-insert-${randomUUID()}`,
      payload: {},
      fetched_at: new Date().toISOString(),
    });
    expect(insert.error).not.toBeNull();

    const update = await client
      .from('marketplace_finance_records')
      .update({ transaction_type: 'Tampered' })
      .eq('id', stack.financeRecordId)
      .select();
    if (update.error === null) expect(update.data).toEqual([]);

    const remove = await client
      .from('marketplace_finance_records')
      .delete()
      .eq('id', stack.financeRecordId)
      .select();
    if (remove.error === null) expect(remove.data).toEqual([]);
  });

  it('authenticated client cannot write profit_recompute_queue (default-deny)', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const stack = await seedProfitStack(org.id, store.id);
    const other = await createOrder(org.id, store.id);

    const insert = await client.from('profit_recompute_queue').insert({
      organization_id: org.id,
      store_id: store.id,
      order_id: other.id,
      reason: 'MANUAL',
    });
    expect(insert.error).not.toBeNull();

    const update = await client
      .from('profit_recompute_queue')
      .update({ reason: 'MANUAL' })
      .eq('id', stack.recomputeRequestId)
      .select();
    if (update.error === null) expect(update.data).toEqual([]);

    const remove = await client
      .from('profit_recompute_queue')
      .delete()
      .eq('id', stack.recomputeRequestId)
      .select();
    if (remove.error === null) expect(remove.data).toEqual([]);
  });
});
