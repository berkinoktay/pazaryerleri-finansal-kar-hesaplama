import type { SyncType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { deriveStaleHours, newestPrimarySyncedAt } from '@/features/sync/lib/stale-data';

const NOW = new Date('2026-07-13T12:00:00.000Z');
const STALE_AFTER_HOURS = 24;

function hoursBefore(ref: Date, hours: number): string {
  return new Date(ref.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function source(syncType: SyncType, lastSyncedAt: string | null) {
  return { syncType, lastSyncedAt };
}

describe('deriveStaleHours', () => {
  it('returns the floored hour count once older than the window (25h → 25)', () => {
    expect(deriveStaleHours(hoursBefore(NOW, 25), NOW, STALE_AFTER_HOURS)).toBe(25);
  });

  it('returns null when still within the window (23h → null)', () => {
    expect(deriveStaleHours(hoursBefore(NOW, 23), NOW, STALE_AFTER_HOURS)).toBeNull();
  });

  it('treats exactly the threshold as fresh (strictly greater)', () => {
    expect(deriveStaleHours(hoursBefore(NOW, 24), NOW, STALE_AFTER_HOURS)).toBeNull();
  });

  it('floors a fractional age (26.9h → 26)', () => {
    expect(deriveStaleHours(hoursBefore(NOW, 26.9), NOW, STALE_AFTER_HOURS)).toBe(26);
  });

  it('honors a per-page window (48h threshold, 30h → null)', () => {
    expect(deriveStaleHours(hoursBefore(NOW, 30), NOW, 48)).toBeNull();
  });
});

describe('newestPrimarySyncedAt', () => {
  it('ignores a fresh secondary flow and reports the aged primary (Returns)', () => {
    // Returns: primary CLAIMS 30h stale, secondary ORDERS 1h fresh. The banner
    // must see the 30h CLAIMS, not the fresh ORDERS.
    const claims = hoursBefore(NOW, 30);
    const sources = [source('CLAIMS', claims), source('ORDERS', hoursBefore(NOW, 1))];
    expect(newestPrimarySyncedAt(sources, ['CLAIMS'])).toBe(claims);
  });

  it('takes the freshest among multiple primaries (Products delta wins)', () => {
    // Products: PRODUCTS 30h old, PRODUCTS_DELTA 1h fresh — both primary. The
    // freshest primary keeps the page fresh, so the newest wins.
    const delta = hoursBefore(NOW, 1);
    const sources = [source('PRODUCTS', hoursBefore(NOW, 30)), source('PRODUCTS_DELTA', delta)];
    expect(newestPrimarySyncedAt(sources, ['PRODUCTS', 'PRODUCTS_DELTA'])).toBe(delta);
  });

  it('skips primaries that never succeeded (null lastSyncedAt)', () => {
    const products = hoursBefore(NOW, 5);
    const sources = [source('PRODUCTS', null), source('PRODUCTS_DELTA', products)];
    expect(newestPrimarySyncedAt(sources, ['PRODUCTS', 'PRODUCTS_DELTA'])).toBe(products);
  });

  it('returns null when no primary source has ever succeeded', () => {
    const sources = [source('CLAIMS', null), source('ORDERS', hoursBefore(NOW, 1))];
    expect(newestPrimarySyncedAt(sources, ['CLAIMS'])).toBeNull();
  });
});
