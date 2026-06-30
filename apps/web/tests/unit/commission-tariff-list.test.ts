import { describe, expect, it } from 'vitest';

import {
  countDistinctProducts,
  matchesTariffQuery,
  summarizeTariffList,
  toListRows,
  type TariffListRow,
} from '@/features/campaigns/lib/commission-tariff-list';
import { MOCK_TARIFF_TEMPLATES } from '@/features/campaigns/lib/mock-commission-tariffs';

const byId = (id: string): (typeof MOCK_TARIFF_TEMPLATES)[number] => {
  const template = MOCK_TARIFF_TEMPLATES.find((t) => t.id === id);
  if (template === undefined) throw new Error(`mock template ${id} missing`);
  return template;
};

const findRow = (rows: TariffListRow[], id: string): TariffListRow => {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`row ${id} missing`);
  return row;
};

describe('countDistinctProducts', () => {
  it('counts a product once even when it repeats across periods', () => {
    // tpl-2330-haz: [r1,r2,r3] + [r1,r3,r4,r5] → {r1..r5} = 5 distinct
    expect(countDistinctProducts(byId('tpl-2330-haz'))).toBe(5);
  });

  it('counts a single-period draft', () => {
    expect(countDistinctProducts(byId('tpl-taslak'))).toBe(2);
  });
});

describe('toListRows', () => {
  const rows = toListRows(MOCK_TARIFF_TEMPLATES, {
    'tpl-2330-haz': true,
    'tpl-1623-haz': true,
  });

  it('projects every template to a row', () => {
    expect(rows).toHaveLength(MOCK_TARIFF_TEMPLATES.length);
  });

  it('carries display fields and derived product count', () => {
    const active = findRow(rows, 'tpl-2330-haz');
    expect(active.name).toBe('23 – 30 Haziran 2026');
    expect(active.sourceFilename).toBe('komisyon_tarifesi_2330_haz.xlsx');
    expect(active.relativeLabel).toBe('Bu hafta');
    expect(active.productCount).toBe(5);
    expect(active.validity).toBe('active');
  });

  it('reflects the exported flag from the map (default false)', () => {
    expect(findRow(rows, 'tpl-2330-haz').exported).toBe(true);
    expect(findRow(rows, 'tpl-3007-tem').exported).toBe(false);
  });

  it('exposes a null validity for the draft', () => {
    expect(findRow(rows, 'tpl-taslak').validity).toBeNull();
  });
});

describe('summarizeTariffList', () => {
  it('summarises totals, the active period, coverage and export count', () => {
    const stats = summarizeTariffList(MOCK_TARIFF_TEMPLATES, {
      'tpl-2330-haz': true,
      'tpl-1623-haz': true,
      'tpl-0916-haz': true,
    });
    expect(stats.total).toBe(MOCK_TARIFF_TEMPLATES.length);
    expect(stats.activeLabel).toBe('Bu hafta');
    expect(stats.coveredProducts).toBe(5);
    expect(stats.exportedCount).toBe(3);
  });

  it('returns null active fields when no tariff is live', () => {
    const stats = summarizeTariffList([byId('tpl-taslak')], {});
    expect(stats.total).toBe(1);
    expect(stats.activeLabel).toBeNull();
    expect(stats.coveredProducts).toBeNull();
    expect(stats.exportedCount).toBe(0);
  });
});

describe('matchesTariffQuery', () => {
  const rows = toListRows(MOCK_TARIFF_TEMPLATES, {});
  const active = findRow(rows, 'tpl-2330-haz');

  it('matches every row on an empty query', () => {
    expect(matchesTariffQuery(active, '')).toBe(true);
    expect(matchesTariffQuery(active, '   ')).toBe(true);
  });

  it('matches the date-range name case-insensitively', () => {
    expect(matchesTariffQuery(active, 'haziran')).toBe(true);
    expect(matchesTariffQuery(active, 'TEMMUZ')).toBe(false);
  });

  it('matches the source file name and relative label', () => {
    expect(matchesTariffQuery(active, '2330_haz.xlsx')).toBe(true);
    expect(matchesTariffQuery(active, 'bu hafta')).toBe(true);
  });
});
