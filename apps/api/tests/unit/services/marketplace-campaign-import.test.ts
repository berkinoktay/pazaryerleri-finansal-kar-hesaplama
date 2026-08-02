import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readWorkbookGrid } from '@pazarsync/spreadsheet';
import { describe, expect, it } from 'vitest';

import { parseCampaignRows } from '@/services/marketplace-campaign-import.service';
import { resolveMarketplaceCampaignLayout } from '@/services/marketplace-campaign-layout';

const FIXTURE = resolve(__dirname, '../../fixtures/marketplace-campaign-sample.xlsx');

describe('parseCampaignRows', () => {
  it('gerçek Trendyol dosyasının tüm ürün satırlarını çözer', async () => {
    const grid = await readWorkbookGrid(readFileSync(FIXTURE));
    const layout = resolveMarketplaceCampaignLayout(grid[0] ?? []);
    expect(layout).not.toBeNull();

    const { rows, skippedRows } = parseCampaignRows(grid, layout!);
    expect(rows).toHaveLength(68);
    expect(skippedRows).toBe(0);

    const first = rows[0]!;
    expect(first.barcode).toBe('211537788423');
    expect(first.currentPrice).toBe('249.00');
    expect(first.maxPrice).toBe('249.00');
    expect(first.hasCommissionTariff).toBe(false);
    expect(first.stock).toBe(100);
  });

  it('"Ürün Komisyon Tarifesi" Var olan satırı işaretler', async () => {
    const grid = await readWorkbookGrid(readFileSync(FIXTURE));
    const layout = resolveMarketplaceCampaignLayout(grid[0] ?? [])!;
    const { rows } = parseCampaignRows(grid, layout);
    expect(rows.filter((r) => r.hasCommissionTariff)).toHaveLength(28);
  });

  it('barkodu ya da fiyatı olmayan satırı atlar', () => {
    const layout = resolveMarketplaceCampaignLayout([
      'Barkod',
      'Ürün Adı',
      'Ürün Kodu',
      'Kategori',
      'Marka',
      'Renk',
      'Beden',
      'Stok Kodu',
      'Mevcut Stok',
      'Mevcut Satış Fiyatı',
      'Maksimum Girebileceğin Fiyat',
      'Kampanyalı Satış Fiyatı',
      'Ürün Komisyon Tarifesi',
      'ListingId',
    ])!;
    const grid = [
      [], // başlık yerine geçer, parseCampaignRows 1. satırdan başlar
      ['', 'Adsız', '', '', '', '', '', '', 1, 100, 100, '', 'Yok', 'x'],
      ['BC-1', 'Ürün', '', '', '', '', '', '', 1, '', '', '', 'Yok', 'x'],
      ['BC-2', 'Ürün', '', '', '', '', '', '', 5, 200, 180, '', 'Var', 'y'],
    ];
    const { rows, skippedRows } = parseCampaignRows(grid, layout);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.barcode).toBe('BC-2');
    expect(rows[0]?.maxPrice).toBe('180.00');
    expect(skippedRows).toBe(2);
  });
});
