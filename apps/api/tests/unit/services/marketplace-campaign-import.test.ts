import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readWorkbookGrid } from '@pazarsync/spreadsheet';
import { describe, expect, it } from 'vitest';

import { parseCampaignRows } from '@/services/marketplace-campaign-import.service';
import { resolveMarketplaceCampaignLayout } from '@/services/marketplace-campaign-layout';

const FIXTURE = resolve(__dirname, '../../fixtures/marketplace-campaign-sample.xlsx');

// Sentetik testlerin paylaştığı başlık satırı — resolveMarketplaceCampaignLayout'un
// katı şablonunun beklediği 14 kolonun hepsi.
const SYNTHETIC_HEADER = [
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
];

describe('parseCampaignRows', () => {
  it('gerçek Trendyol dosyasının tüm ürün satırlarını çözer', async () => {
    const grid = await readWorkbookGrid(readFileSync(FIXTURE));
    const layout = resolveMarketplaceCampaignLayout(grid[0] ?? []);
    expect(layout).not.toBeNull();

    const { rows, skippedRows } = parseCampaignRows(grid, layout!);
    expect(rows).toHaveLength(68);
    expect(skippedRows).toBe(0);

    // rows[0]'ın 13 alanının TAMAMI — yalnız fiyat/tarife değil, kolon-alan eşlemesinin
    // (örn. brand↔color yer değiştirmesi gibi bir kaymanın) da sessizce geçmemesi için.
    const first = rows[0]!;
    expect(first.barcode).toBe('211537788423');
    expect(first.productTitle).toBe('(5 Adet) Sopalı Türk Bayrağı 20x30 cm – Bez Alpaka Kumaş');
    expect(first.productCode).toBe('TB-ALPAKA-SOPALI-5-20x30');
    expect(first.category).toBe('Bayrak');
    expect(first.brand).toBe('AKYILDIZ store');
    expect(first.color).toBeNull();
    expect(first.size).toBeNull();
    expect(first.stockCode).toBeNull();
    expect(first.stock).toBe(100);
    expect(first.currentPrice).toBe('249.00');
    expect(first.maxPrice).toBe('249.00');
    expect(first.hasCommissionTariff).toBe(false);
    expect(first.externalId).toBe('eec44a62cba641fd75d6300c32da1957');
  });

  it('"Ürün Komisyon Tarifesi" Var olan satırı işaretler', async () => {
    const grid = await readWorkbookGrid(readFileSync(FIXTURE));
    const layout = resolveMarketplaceCampaignLayout(grid[0] ?? [])!;
    const { rows } = parseCampaignRows(grid, layout);
    expect(rows.filter((r) => r.hasCommissionTariff)).toHaveLength(28);
  });

  it('barkodu, mevcut fiyatı ya da maksimum fiyatı olmayan satırı atlar', () => {
    const layout = resolveMarketplaceCampaignLayout(SYNTHETIC_HEADER)!;
    const grid = [
      [], // başlık yerine geçer, parseCampaignRows 1. satırdan başlar
      ['', 'Adsız', '', '', '', '', '', '', 1, 100, 100, '', 'Yok', 'x'], // barkod yok
      ['BC-1', 'Ürün', '', '', '', '', '', '', 1, '', '', '', 'Yok', 'x'], // mevcut fiyat yok
      // Maksimum fiyat, birinci fiyat seçeneği VE özel fiyatın tavanı olduğu için mevcut
      // fiyat okunabilse bile TEK BAŞINA zorunludur — bu satır onu ayrı ayrı kanıtlar.
      ['BC-3', 'Ürün', '', '', '', '', '', '', 1, 150, '', '', 'Yok', 'z'], // maksimum fiyat yok
      ['BC-2', 'Ürün', '', '', '', '', '', '', 5, 200, 180, '', 'Var', 'y'], // kullanılabilir
    ];
    const { rows, skippedRows } = parseCampaignRows(grid, layout);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.barcode).toBe('BC-2');
    expect(rows[0]?.maxPrice).toBe('180.00');
    expect(skippedRows).toBe(3);
  });

  it('satır sırasını korur — export sortOrder buna dayanır ve sıra kayarsa fiyat yanlış ürüne yazılır', () => {
    const layout = resolveMarketplaceCampaignLayout(SYNTHETIC_HEADER)!;
    // Barkodlar bilerek ne artan ne azalan sırada: kazara eklenecek bir .sort() (artan
    // sıra verir) ya da bir .reverse() (B-002,C-003,A-001 verir) bu diziliş üzerinde
    // de gözlemlenebilir bir fark yaratır — testin ikisini de yakalaması için.
    const grid = [
      [],
      ['B-002', 'Ürün B', '', '', '', '', '', '', 1, 100, 90, '', 'Yok', 'b'],
      ['C-003', 'Ürün C', '', '', '', '', '', '', 1, 100, 90, '', 'Yok', 'c'],
      ['A-001', 'Ürün A', '', '', '', '', '', '', 1, 100, 90, '', 'Yok', 'a'],
    ];
    const { rows } = parseCampaignRows(grid, layout);
    expect(rows.map((r) => r.barcode)).toEqual(['B-002', 'C-003', 'A-001']);
  });
});
