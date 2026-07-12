import { describe, expect, it } from 'vitest';

import {
  derivePageSync,
  type PageSyncFreshnessEntry,
  type PageSyncLogRow,
} from '@/features/sync/lib/derive-page-sync';

const NOW = new Date('2026-07-11T12:00:00.000Z');
const STORE = 'store-1';

function hoursBefore(ref: Date, hours: number): string {
  return new Date(ref.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function makeLog(
  overrides: Partial<PageSyncLogRow> & Pick<PageSyncLogRow, 'syncType' | 'status'>,
): PageSyncLogRow {
  return {
    storeId: STORE,
    startedAt: '2026-07-11T11:00:00.000Z',
    completedAt: null,
    recordsProcessed: 0,
    progressCurrent: 0,
    progressTotal: null,
    nextAttemptAt: null,
    errorCode: null,
    ...overrides,
  };
}

function makeFreshness(
  overrides: Partial<PageSyncFreshnessEntry> &
    Pick<PageSyncFreshnessEntry, 'syncType' | 'completedAt'>,
): PageSyncFreshnessEntry {
  return {
    storeId: STORE,
    recordsProcessed: 0,
    ...overrides,
  };
}

function run(input: {
  pageKey: Parameters<typeof derivePageSync>[0]['pageKey'];
  activeSyncs?: PageSyncLogRow[];
  recentSyncs?: PageSyncLogRow[];
  freshness?: PageSyncFreshnessEntry[];
  storeId?: string;
  now?: Date;
}): ReturnType<typeof derivePageSync> {
  return derivePageSync({
    pageKey: input.pageKey,
    storeId: input.storeId ?? STORE,
    activeSyncs: input.activeSyncs ?? [],
    recentSyncs: input.recentSyncs ?? [],
    freshness: input.freshness ?? [],
    now: input.now ?? NOW,
  });
}

describe('derivePageSync', () => {
  it('rule 1: takes the timestamp from freshness even when the type is not in the recent cap', () => {
    const orderedAt = hoursBefore(NOW, 1);
    const vm = run({
      pageKey: 'orders',
      // recentSyncs holds a different type only — ORDERS aged off the capped list.
      recentSyncs: [
        makeLog({ syncType: 'SETTLEMENTS', status: 'COMPLETED', completedAt: hoursBefore(NOW, 2) }),
      ],
      freshness: [
        makeFreshness({ syncType: 'ORDERS', completedAt: orderedAt, recordsProcessed: 42 }),
      ],
    });

    expect(vm.control.state).toBe('fresh');
    expect(vm.control.lastSyncedAt).toBe(orderedAt);
    const ordersSource = vm.sources.find((s) => s.syncType === 'ORDERS');
    expect(ordersSource?.lastSyncedAt).toBe(orderedAt);
    expect(ordersSource?.recordsProcessed).toBe(42);
    expect(ordersSource?.state).toBe('fresh');
  });

  it('rule 2: a failed secondary drags the control to failed while lastSyncedAt stays on the primary', () => {
    const primaryAt = hoursBefore(NOW, 1);
    const vm = run({
      // profitability = primary SETTLEMENTS + secondary ORDERS (orders no longer
      // has a secondary, so the "failed secondary" rule is exercised here).
      pageKey: 'profitability',
      recentSyncs: [
        makeLog({ syncType: 'ORDERS', status: 'FAILED', errorCode: 'MARKETPLACE_UNREACHABLE' }),
      ],
      freshness: [makeFreshness({ syncType: 'SETTLEMENTS', completedAt: primaryAt })],
    });

    // Every source counts equally now: a failed secondary pulls the whole
    // control to 'failed', while the timestamp still reflects the primary.
    expect(vm.control.state).toBe('failed');
    expect(vm.control.lastSyncedAt).toBe(primaryAt);
    const orders = vm.sources.find((s) => s.syncType === 'ORDERS');
    expect(orders?.state).toBe('failed');
    expect(orders?.errorCode).toBe('MARKETPLACE_UNREACHABLE');
  });

  it("rule 3: another page's active type keeps the control fresh and lands in others", () => {
    const vm = run({
      pageKey: 'orders',
      activeSyncs: [
        makeLog({ syncType: 'PRODUCTS', status: 'RUNNING', progressCurrent: 5, progressTotal: 10 }),
      ],
      freshness: [
        makeFreshness({ syncType: 'ORDERS', completedAt: hoursBefore(NOW, 1) }),
        makeFreshness({ syncType: 'SETTLEMENTS', completedAt: hoursBefore(NOW, 1) }),
      ],
    });

    expect(vm.control.state).toBe('fresh');
    expect(vm.others).toHaveLength(1);
    expect(vm.others[0]?.syncType).toBe('PRODUCTS');
    expect(vm.others[0]?.status).toBe('RUNNING');
    expect(vm.others[0]?.progress).toEqual({ current: 5, total: 10 });
    // PRODUCTS is not an orders-page source, so no source row exists for it.
    expect(vm.sources.some((s) => s.syncType === 'PRODUCTS')).toBe(false);
  });

  it('passes primary syncing progress through to the control and the source row', () => {
    const vm = run({
      pageKey: 'orders',
      activeSyncs: [
        makeLog({ syncType: 'ORDERS', status: 'RUNNING', progressCurrent: 30, progressTotal: 100 }),
      ],
      freshness: [makeFreshness({ syncType: 'ORDERS', completedAt: hoursBefore(NOW, 3) })],
    });

    expect(vm.control.state).toBe('syncing');
    expect(vm.control.progress).toEqual({ current: 30, total: 100 });
    const ordersSource = vm.sources.find((s) => s.syncType === 'ORDERS');
    expect(ordersSource?.state).toBe('syncing');
    expect(ordersSource?.progress).toEqual({ current: 30, total: 100 });
    // last success stays visible even mid-run.
    expect(ordersSource?.lastSyncedAt).toBe(hoursBefore(NOW, 3));
  });

  it('surfaces the retry schedule when the primary is retrying', () => {
    const nextAttempt = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();
    const vm = run({
      pageKey: 'orders',
      activeSyncs: [
        makeLog({
          syncType: 'ORDERS',
          status: 'FAILED_RETRYABLE',
          nextAttemptAt: nextAttempt,
          errorCode: 'MARKETPLACE_RATE_LIMITED',
        }),
      ],
    });

    expect(vm.control.state).toBe('retrying');
    expect(vm.control.nextAttemptAt).toBe(nextAttempt);
    expect(vm.control.progress).toBeNull();
    const ordersSource = vm.sources.find((s) => s.syncType === 'ORDERS');
    expect(ordersSource?.state).toBe('retrying');
    expect(ordersSource?.nextAttemptAt).toBe(nextAttempt);
    expect(ordersSource?.errorCode).toBe('MARKETPLACE_RATE_LIMITED');
    expect(ordersSource?.progress).toBeNull();
  });

  it('reads failed when the most recent run of the primary failed', () => {
    const vm = run({
      pageKey: 'orders',
      recentSyncs: [
        makeLog({ syncType: 'ORDERS', status: 'FAILED', errorCode: 'MARKETPLACE_AUTH_FAILED' }),
      ],
    });

    expect(vm.control.state).toBe('failed');
    const ordersSource = vm.sources.find((s) => s.syncType === 'ORDERS');
    expect(ordersSource?.state).toBe('failed');
    expect(ordersSource?.errorCode).toBe('MARKETPLACE_AUTH_FAILED');
  });

  it('applies the staleAfterHours threshold: 23h reads fresh, 25h reads stale', () => {
    const freshVm = run({
      pageKey: 'orders', // staleAfterHours 24
      freshness: [makeFreshness({ syncType: 'ORDERS', completedAt: hoursBefore(NOW, 23) })],
    });
    expect(freshVm.control.state).toBe('fresh');

    const staleVm = run({
      pageKey: 'orders',
      freshness: [makeFreshness({ syncType: 'ORDERS', completedAt: hoursBefore(NOW, 25) })],
    });
    expect(staleVm.control.state).toBe('stale');
    expect(staleVm.sources.find((s) => s.syncType === 'ORDERS')?.state).toBe('stale');
  });

  it('returns fresh with a null timestamp when there is no data at all', () => {
    const vm = run({ pageKey: 'orders' });

    expect(vm.control.state).toBe('fresh');
    expect(vm.control.lastSyncedAt).toBeNull();
    expect(vm.control.progress).toBeNull();
    expect(vm.control.nextAttemptAt).toBeNull();
    const ordersSource = vm.sources.find((s) => s.syncType === 'ORDERS');
    expect(ordersSource?.lastSyncedAt).toBeNull();
    expect(ordersSource?.recordsProcessed).toBeNull();
    expect(vm.others).toHaveLength(0);
  });

  it('dashboard control timestamp is the NEWEST source success (no more oldest exception)', () => {
    const vm = run({
      pageKey: 'dashboard',
      freshness: [
        makeFreshness({ syncType: 'ORDERS', completedAt: '2026-07-11T11:00:00.000Z' }),
        makeFreshness({ syncType: 'PRODUCTS', completedAt: '2026-07-11T06:00:00.000Z' }),
        makeFreshness({ syncType: 'SETTLEMENTS', completedAt: '2026-07-11T09:00:00.000Z' }),
      ],
    });

    expect(vm.control.lastSyncedAt).toBe('2026-07-11T11:00:00.000Z');
  });

  it('partitions others: same-store page type is excluded, different-store same type is included', () => {
    const vm = run({
      pageKey: 'orders',
      activeSyncs: [
        // Same store, the page's own type -> a source, NOT an other.
        makeLog({
          syncType: 'ORDERS',
          status: 'RUNNING',
          progressCurrent: 1,
          progressTotal: 4,
        }),
        // Different store, same type -> lands in others.
        makeLog({
          storeId: 'store-2',
          syncType: 'ORDERS',
          status: 'RUNNING',
          progressCurrent: 2,
          progressTotal: 8,
        }),
      ],
      freshness: [makeFreshness({ syncType: 'ORDERS', completedAt: hoursBefore(NOW, 1) })],
    });

    expect(vm.others).toHaveLength(1);
    expect(vm.others[0]?.storeId).toBe('store-2');
    expect(vm.others[0]?.syncType).toBe('ORDERS');
    expect(vm.others.every((o) => o.storeId !== STORE)).toBe(true);
  });

  it('products page: the newer PRODUCTS_DELTA success wins the control timestamp over PRODUCTS', () => {
    const deltaAt = '2026-07-11T11:00:00.000Z';
    const vm = run({
      pageKey: 'products',
      freshness: [
        makeFreshness({ syncType: 'PRODUCTS', completedAt: '2026-07-11T08:00:00.000Z' }),
        makeFreshness({ syncType: 'PRODUCTS_DELTA', completedAt: deltaAt }),
      ],
    });

    expect(vm.control.state).toBe('fresh');
    expect(vm.control.lastSyncedAt).toBe(deltaAt);
    expect(vm.sources.map((s) => s.syncType)).toEqual(['PRODUCTS', 'PRODUCTS_DELTA']);
  });

  it('control timestamp takes the newest success across ALL sources, including secondary', () => {
    const settlementAt = '2026-07-11T08:00:00.000Z';
    const orderAt = '2026-07-11T11:00:00.000Z';
    const vm = run({
      // profitability = primary SETTLEMENTS + secondary ORDERS.
      pageKey: 'profitability',
      freshness: [
        makeFreshness({ syncType: 'SETTLEMENTS', completedAt: settlementAt }),
        makeFreshness({ syncType: 'ORDERS', completedAt: orderAt }),
      ],
    });

    expect(vm.control.state).toBe('fresh');
    // The secondary ORDERS success is newer than the primary SETTLEMENTS one and
    // wins the timestamp — every source feeds the newest-wins rule equally.
    expect(vm.control.lastSyncedAt).toBe(orderAt);
  });

  it('control progress prefers the first active source with a known total', () => {
    const vm = run({
      pageKey: 'products', // PRODUCTS then PRODUCTS_DELTA
      activeSyncs: [
        makeLog({
          syncType: 'PRODUCTS',
          status: 'RUNNING',
          progressCurrent: 3,
          progressTotal: null,
        }),
        makeLog({
          syncType: 'PRODUCTS_DELTA',
          status: 'RUNNING',
          progressCurrent: 40,
          progressTotal: 200,
        }),
      ],
    });

    expect(vm.control.state).toBe('syncing');
    // PRODUCTS is active first but has an unknown total; the control shows the
    // first active source WITH a known total instead.
    expect(vm.control.progress).toEqual({ current: 40, total: 200 });
  });

  it('control state prioritizes syncing over a failed sibling source', () => {
    const vm = run({
      pageKey: 'products',
      activeSyncs: [
        makeLog({ syncType: 'PRODUCTS', status: 'RUNNING', progressCurrent: 5, progressTotal: 10 }),
      ],
      recentSyncs: [
        makeLog({
          syncType: 'PRODUCTS_DELTA',
          status: 'FAILED',
          errorCode: 'MARKETPLACE_AUTH_FAILED',
        }),
      ],
    });

    expect(vm.control.state).toBe('syncing');
    expect(vm.control.progress).toEqual({ current: 5, total: 10 });
  });
});
