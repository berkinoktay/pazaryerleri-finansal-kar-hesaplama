import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';
import { describe, expect, it } from 'vitest';

import { patchXlsxCells, type XlsxCellValue } from '@/lib/xlsx-patch';
import { resolveCampaignExportPrice } from '@/services/marketplace-campaign-export.service';
import { resolveMarketplaceCampaignLayout } from '@/services/marketplace-campaign-layout';

const FIXTURE = resolve(__dirname, '../../fixtures/marketplace-campaign-sample.xlsx');

describe('resolveCampaignExportPrice', () => {
  it('NONE seçiminde null döner (hücre boş kalır)', () => {
    expect(
      resolveCampaignExportPrice({
        selection: 'NONE',
        maxPrice: new Prisma.Decimal('249'),
        customPrice: new Prisma.Decimal('200'),
      }),
    ).toBeNull();
  });

  it('MAX seçiminde maksimum fiyatı döner', () => {
    expect(
      resolveCampaignExportPrice({
        selection: 'MAX',
        maxPrice: new Prisma.Decimal('249'),
        customPrice: null,
      }),
    ).toBe('249.00');
  });

  it('CUSTOM seçiminde özel fiyatı döner', () => {
    expect(
      resolveCampaignExportPrice({
        selection: 'CUSTOM',
        maxPrice: new Prisma.Decimal('249'),
        customPrice: new Prisma.Decimal('199.9'),
      }),
    ).toBe('199.90');
  });

  it('CUSTOM seçiliyken özel fiyat yoksa null döner (yazma yapılmaz)', () => {
    expect(
      resolveCampaignExportPrice({
        selection: 'CUSTOM',
        maxPrice: new Prisma.Decimal('249'),
        customPrice: null,
      }),
    ).toBeNull();
  });
});

describe('kampanya export round-trip', () => {
  it('yalnız hedef hücreleri değiştirir, kalan byte akışını korur', async () => {
    const source = readFileSync(FIXTURE);
    const grid = await readWorkbookGrid(source);
    const layout = resolveMarketplaceCampaignLayout(grid[0] ?? [])!;

    // İlk veri satırının (Excel 2. satırı) kampanya fiyatı hücresini yamala.
    const patches = new Map<number, Map<number, XlsxCellValue>>();
    patches.set(2, new Map([[layout.campaignPrice, { kind: 'number', value: '249.00' }]]));
    const patched = patchXlsxCells(source, patches);

    const reread = await readWorkbookGrid(patched);
    expect(String(reread[1]?.[layout.campaignPrice])).toContain('249');
    // Yamalanmamış satır aynı kalmalı.
    expect(reread[2]?.[layout.barcode]).toBe(grid[2]?.[layout.barcode]);
    expect(reread).toHaveLength(grid.length);
    // Başlık satırı dokunulmamalı.
    expect(reread[0]).toEqual(grid[0]);
  });
});
