// Unit tests for the pure per-sub-period export grouping + single-download bundling.
//
// `planExportFiles` decides which product goes into which of the 1-or-2 files and
// with what "Tarife Seçimi" label; `bundleForDownload` packages those files into one
// HTTP body (a lone .xlsx, or a .zip when a split week needs two window files). Both
// are pure (no DB, no I/O), so they're covered here rather than in the route suite.

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  bundleForDownload,
  planExportFiles,
  XLSX_MIME,
  ZIP_MIME,
  type ExportFile,
  type PeriodSelection,
} from '@/services/commission-tariff-export.service';

function period(dayCount: number | null, prices: Record<string, string>): PeriodSelection {
  return { dayCount, pricesByBarcode: new Map(Object.entries(prices)) };
}

describe('planExportFiles', () => {
  it('returns nothing when no product is selected', () => {
    expect(planExportFiles([period(3, {}), period(4, {})])).toEqual([]);
    expect(planExportFiles([])).toEqual([]);
  });

  it('a full-week (single 7-day period) tariff yields one "7 Günlük Fiyat" file, day-suffixed', () => {
    const plans = planExportFiles([period(7, { A: '100.00', B: '250.00' })]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.suffix).toBe('7-gunluk');
    expect(plans[0]?.rows.get('A')).toEqual({ newPrice: '100.00', selection: '7 Günlük Fiyat' });
    expect(plans[0]?.rows.get('B')).toEqual({ newPrice: '250.00', selection: '7 Günlük Fiyat' });
  });

  it('a same-price product collapses into ONE "7 Günlük Fiyat" file', () => {
    const plans = planExportFiles([period(3, { A: '150.00' }), period(4, { A: '150.00' })]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.suffix).toBe('7-gunluk');
    expect(plans[0]?.rows.get('A')).toEqual({ newPrice: '150.00', selection: '7 Günlük Fiyat' });
  });

  it('a 3-Gün ≠ 4-Gün product splits into the 3-gün and 4-gün files (no 7-gün)', () => {
    const plans = planExportFiles([period(3, { A: '150.00' }), period(4, { A: '190.00' })]);
    expect(plans).toHaveLength(2);
    expect(plans.find((p) => p.suffix === '7-gunluk')).toBeUndefined();
    expect(plans.find((p) => p.suffix === '3-gunluk')?.rows.get('A')).toEqual({
      newPrice: '150.00',
      selection: '3 Günlük Fiyat',
    });
    expect(plans.find((p) => p.suffix === '4-gunluk')?.rows.get('A')).toEqual({
      newPrice: '190.00',
      selection: '4 Günlük Fiyat',
    });
  });

  it('a product selected only in the 3-Gün period → just the 3-gün file', () => {
    const plans = planExportFiles([period(3, { A: '150.00' }), period(4, {})]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.suffix).toBe('3-gunluk');
    expect(plans[0]?.rows.get('A')).toEqual({ newPrice: '150.00', selection: '3 Günlük Fiyat' });
  });

  it('a product selected only in the 4-Gün period → just the 4-gün file', () => {
    const plans = planExportFiles([period(3, {}), period(4, { A: '190.00' })]);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.suffix).toBe('4-gunluk');
    expect(plans[0]?.rows.get('A')).toEqual({ newPrice: '190.00', selection: '4 Günlük Fiyat' });
  });

  it('buckets a mix of whole-week, split, and single-window products correctly', () => {
    const plans = planExportFiles([
      period(3, { SAME: '100.00', DIFF: '150.00', ONLY3: '120.00' }),
      period(4, { SAME: '100.00', DIFF: '190.00' }),
    ]);
    // SAME → 7-gün only; DIFF → both 3- and 4-gün; ONLY3 → 3-gün only.
    const seven = plans.find((p) => p.suffix === '7-gunluk');
    const three = plans.find((p) => p.suffix === '3-gunluk');
    const four = plans.find((p) => p.suffix === '4-gunluk');
    expect(seven?.rows.get('SAME')).toEqual({ newPrice: '100.00', selection: '7 Günlük Fiyat' });
    expect(seven?.rows.has('DIFF')).toBe(false);
    expect(three?.rows.get('DIFF')).toEqual({ newPrice: '150.00', selection: '3 Günlük Fiyat' });
    expect(three?.rows.get('ONLY3')).toEqual({ newPrice: '120.00', selection: '3 Günlük Fiyat' });
    expect(three?.rows.has('SAME')).toBe(false);
    expect(four?.rows.get('DIFF')).toEqual({ newPrice: '190.00', selection: '4 Günlük Fiyat' });
    expect(four?.rows.has('ONLY3')).toBe(false);
  });
});

describe('bundleForDownload', () => {
  const single: ExportFile = { filename: 'tariff.xlsx', file: Buffer.from('AAA') };
  const three: ExportFile = { filename: 'tariff-3-gunluk.xlsx', file: Buffer.from('AAA') };
  const four: ExportFile = { filename: 'tariff-4-gunluk.xlsx', file: Buffer.from('BBB') };

  it('streams a lone file as its .xlsx unchanged', () => {
    const bundle = bundleForDownload([single]);
    expect(bundle.contentType).toBe(XLSX_MIME);
    expect(bundle.filename).toBe('tariff.xlsx');
    expect(bundle.body.equals(Buffer.from('AAA'))).toBe(true);
  });

  it('bundles two window files into a .zip named after the tariff (suffix stripped)', () => {
    const bundle = bundleForDownload([three, four]);
    expect(bundle.contentType).toBe(ZIP_MIME);
    expect(bundle.filename).toBe('tariff.zip');

    const entries = unzipSync(new Uint8Array(bundle.body));
    expect(Object.keys(entries).sort()).toEqual(['tariff-3-gunluk.xlsx', 'tariff-4-gunluk.xlsx']);
    expect(Buffer.from(entries['tariff-3-gunluk.xlsx'] ?? new Uint8Array()).toString()).toBe('AAA');
    expect(Buffer.from(entries['tariff-4-gunluk.xlsx'] ?? new Uint8Array()).toString()).toBe('BBB');
  });

  it('throws when there are no files to deliver', () => {
    expect(() => bundleForDownload([])).toThrow();
  });
});
