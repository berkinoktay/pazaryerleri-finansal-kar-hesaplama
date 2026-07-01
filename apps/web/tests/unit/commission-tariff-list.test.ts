import { describe, expect, it } from 'vitest';

import type { CommissionTariffListItem } from '@/features/campaigns/api/list-tariffs.api';
import {
  matchesTariffQuery,
  summarizeTariffList,
  toListRows,
  type TariffListRow,
} from '@/features/campaigns/lib/commission-tariff-list';

function makeItem(overrides: Partial<CommissionTariffListItem>): CommissionTariffListItem {
  return {
    id: 'id-1',
    name: 'Tariff',
    productCount: 0,
    selectedCount: 0,
    exported: false,
    validity: null,
    updatedAt: '2026-06-30T00:00:00Z',
    ...overrides,
  };
}

const items: CommissionTariffListItem[] = [
  makeItem({
    id: 'a',
    name: '23 – 30 Haziran 2026',
    productCount: 5,
    selectedCount: 2,
    exported: true,
    validity: 'active',
  }),
  makeItem({
    id: 'b',
    name: '16 – 23 Haziran 2026',
    productCount: 4,
    exported: true,
    validity: 'past',
  }),
  makeItem({ id: 'c', name: 'Taslak', productCount: 2, validity: null }),
];

const findRow = (rows: TariffListRow[], id: string): TariffListRow => {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`row ${id} missing`);
  return row;
};

describe('toListRows', () => {
  const rows = toListRows(items);

  it('projects every list item to a row', () => {
    expect(rows).toHaveLength(items.length);
  });

  it('carries the server-computed counts + validity + exported flag', () => {
    const active = findRow(rows, 'a');
    expect(active.name).toBe('23 – 30 Haziran 2026');
    expect(active.productCount).toBe(5);
    expect(active.selectedCount).toBe(2);
    expect(active.validity).toBe('active');
    expect(active.exported).toBe(true);
    expect(findRow(rows, 'c').validity).toBeNull();
  });
});

describe('summarizeTariffList', () => {
  it('summarises totals, the active tariff, coverage and export count', () => {
    const stats = summarizeTariffList(toListRows(items));
    expect(stats.total).toBe(3);
    expect(stats.activeLabel).toBe('23 – 30 Haziran 2026');
    expect(stats.coveredProducts).toBe(5);
    expect(stats.exportedCount).toBe(2);
  });

  it('returns null active fields when no tariff is live', () => {
    const stats = summarizeTariffList(toListRows([makeItem({ id: 'c', name: 'Taslak' })]));
    expect(stats.total).toBe(1);
    expect(stats.activeLabel).toBeNull();
    expect(stats.coveredProducts).toBeNull();
    expect(stats.exportedCount).toBe(0);
  });
});

describe('matchesTariffQuery', () => {
  const active = findRow(toListRows(items), 'a');

  it('matches every row on an empty query', () => {
    expect(matchesTariffQuery(active, '')).toBe(true);
    expect(matchesTariffQuery(active, '   ')).toBe(true);
  });

  it('matches the tariff name case-insensitively', () => {
    expect(matchesTariffQuery(active, 'haziran')).toBe(true);
    expect(matchesTariffQuery(active, 'TEMMUZ')).toBe(false);
  });
});
