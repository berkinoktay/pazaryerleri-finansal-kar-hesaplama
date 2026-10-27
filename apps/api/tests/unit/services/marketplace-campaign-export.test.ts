import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma } from '@pazarsync/db';
import { readWorkbookGrid } from '@pazarsync/spreadsheet';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { columnLetter, patchXlsxCells, type XlsxCellValue } from '@/lib/xlsx-patch';
import {
  buildCampaignRowPatches,
  isImportedCampaignRow,
  resolveCampaignExportPrice,
  type CampaignExportItem,
} from '@/services/marketplace-campaign-export.service';
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

describe('kampanya export round-trip (byte-koruma sağlaması)', () => {
  // Bu test yalnız `patchXlsxCells`'in gerçek committed fixture byte'ları üzerinde
  // çalıştığını doğrular (dar kapsam — `patchXlsxCells`'in kendi ayrıntılı takımı
  // `tests/unit/lib/xlsx-patch.test.ts`'te). Servisin asıl riskli mantığı — hangi satırın
  // "import edilmiş" sayıldığı, kalemlerin satırlarla nasıl eşleştiği, barkod savunması —
  // BURADA sınanmıyor; onun için aşağıdaki 'kampanya export — servis seviyesinde satır
  // hizalama' bloğuna bakın.
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

// ─── Servis seviyesinde satır hizalama ────────────────────────────────────────
//
// Yukarıdaki round-trip testi `patchXlsxCells`'i doğrudan çağırıyordu — bu görevin asıl
// eklediği kodun (isImportedCampaignRow, buildCampaignRowPatches, barkod savunması)
// HİÇBİRİNİ çalıştırmıyordu. Aşağıdaki blok gerçek servis fonksiyonlarını sürüyor.
//
// Sentetik bir .xlsx kaynağı gerekiyor çünkü committed fixture'ın (68 satır) skippedRows'u
// 0 — yani atlanan bir satır senaryosunu gerçek fixture'da doğal olarak üretemiyoruz.
// Sentetik dosya, committed fixture'ın zip kabını (Content_Types, workbook.xml, rels,
// styles — readWorkbookGrid'in ihtiyaç duyduğu her şey) yeniden kullanıp YALNIZ worksheet
// satırlarını değiştirir; böylece test gerçek okuma→yama→yeniden-okuma boru hattını uçtan
// uca çalıştırır, sahte bir grid nesnesini değil.

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cellXml(colIdx: number, rowNum: number, value: XlsxCellValue): string {
  const ref = `${columnLetter(colIdx)}${rowNum}`;
  return value.kind === 'number'
    ? `<c r="${ref}"><v>${value.value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value.value)}</t></is></c>`;
}

function rowXml(rowNum: number, cells: ReadonlyMap<number, XlsxCellValue>): string {
  const body = [...cells.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([col, value]) => cellXml(col, rowNum, value))
    .join('');
  return `<row r="${rowNum}">${body}</row>`;
}

// Gerçek Trendyol dosyasıyla (marketplace-campaign-sample.xlsx) BİREBİR aynı 14 kolon sırası
// — resolveMarketplaceCampaignLayout'un katı şablonu tam kümeyi ister.
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

function buildSyntheticCampaignSource(
  dataRows: ReadonlyArray<ReadonlyMap<number, XlsxCellValue>>,
): Buffer {
  const entries = unzipSync(new Uint8Array(readFileSync(FIXTURE)));
  const headerCells = new Map<number, XlsxCellValue>(
    SYNTHETIC_HEADER.map((h, i): [number, XlsxCellValue] => [i, { kind: 'inlineStr', value: h }]),
  );
  const rows = [rowXml(1, headerCells), ...dataRows.map((cells, i) => rowXml(i + 2, cells))];
  const lastCol = columnLetter(SYNTHETIC_HEADER.length - 1);
  const worksheetXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="A1:${lastCol}${dataRows.length + 1}"/>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    '</worksheet>';
  entries['xl/worksheets/sheet1.xml'] = strToU8(worksheetXml);
  return Buffer.from(zipSync(entries));
}

function dataRow(cells: Record<number, XlsxCellValue>): Map<number, XlsxCellValue> {
  return new Map(Object.entries(cells).map(([k, v]): [number, XlsxCellValue] => [Number(k), v]));
}

function textCell(value: string): XlsxCellValue {
  return { kind: 'inlineStr', value };
}
function numberCell(value: number): XlsxCellValue {
  return { kind: 'number', value: String(value) };
}

describe('kampanya export — servis seviyesinde satır hizalama', () => {
  const layout = resolveMarketplaceCampaignLayout(SYNTHETIC_HEADER)!;

  // Dört veri satırı: B-002'nin maksimum fiyatı YOK — gerçek import'un (parseRow) atlayacağı
  // satır tam olarak bu; kalan üçü MAX / CUSTOM / NONE seçimlerinin karışımı.
  const rows = [
    dataRow({
      [layout.barcode]: textCell('A-001'),
      [layout.currentPrice]: numberCell(100),
      [layout.maxPrice]: numberCell(120),
    }), // Excel satır 2 — tutulur, seçim MAX
    dataRow({
      [layout.barcode]: textCell('B-002'),
      [layout.currentPrice]: numberCell(200),
      // Maksimum fiyat hücresi YOK — import'un atlama kuralı bu satırı düşürür.
    }), // Excel satır 3 — ATLANIR
    dataRow({
      [layout.barcode]: textCell('C-003'),
      [layout.currentPrice]: numberCell(150),
      [layout.maxPrice]: numberCell(180),
    }), // Excel satır 4 — tutulur, seçim CUSTOM
    dataRow({
      [layout.barcode]: textCell('D-004'),
      [layout.currentPrice]: numberCell(90),
      [layout.maxPrice]: numberCell(110),
    }), // Excel satır 5 — tutulur, seçim NONE
  ];

  const source = buildSyntheticCampaignSource(rows);

  // sortOrder sıralı kalemler: GERÇEK import'un B-002'yi (maksimum fiyat yok) atlayıp
  // A-001 / C-003 / D-004'ü bu sırayla tutacağı senaryoyu birebir yansıtır.
  const items: CampaignExportItem[] = [
    {
      barcode: 'A-001',
      selection: 'MAX',
      maxPrice: new Prisma.Decimal('120'),
      customPrice: null,
    },
    {
      barcode: 'C-003',
      selection: 'CUSTOM',
      maxPrice: new Prisma.Decimal('180'),
      customPrice: new Prisma.Decimal('170'),
    },
    {
      barcode: 'D-004',
      selection: 'NONE',
      maxPrice: new Prisma.Decimal('110'),
      customPrice: null,
    },
  ];

  it('isImportedCampaignRow, maksimum fiyatı olmayan satırı doğru atlar', async () => {
    const grid = await readWorkbookGrid(source);
    expect(isImportedCampaignRow(grid[1] ?? [], layout)).toBe(true); // A-001
    expect(isImportedCampaignRow(grid[2] ?? [], layout)).toBe(false); // B-002 — maks fiyat yok
    expect(isImportedCampaignRow(grid[3] ?? [], layout)).toBe(true); // C-003
    expect(isImportedCampaignRow(grid[4] ?? [], layout)).toBe(true); // D-004
  });

  it('her yazılan fiyat SAHİBİ barkoduna iner; atlanan ve NONE satırları boş kalır', async () => {
    const grid = await readWorkbookGrid(source);
    const patches = buildCampaignRowPatches(grid, layout, items);
    const patched = patchXlsxCells(source, patches);
    const reread = await readWorkbookGrid(patched);

    // Barkod → yazılan kampanya fiyatı eşlemesini satır POZİSYONUNA değil BARKODA göre kur —
    // "read the produced file back and check the pairing" tam olarak bunu ister.
    const priceByBarcode = new Map<string, unknown>();
    for (let i = 1; i < reread.length; i += 1) {
      const row = reread[i] ?? [];
      const barcode = row[layout.barcode];
      if (typeof barcode === 'string') priceByBarcode.set(barcode, row[layout.campaignPrice]);
    }

    expect(Number(priceByBarcode.get('A-001'))).toBe(120); // MAX → maksimum fiyat
    expect(Number(priceByBarcode.get('C-003'))).toBe(170); // CUSTOM → özel fiyat
    // Atlanan satır (B-002) hiçbir kalem tüketmedi — hücresi kaynakta zaten boştu, öyle kalır.
    expect(priceByBarcode.get('B-002')).toBeFalsy();
    // NONE seçimi hiçbir şey yazmaz — hücre boş kalır.
    expect(priceByBarcode.get('D-004')).toBeFalsy();
  });
});
