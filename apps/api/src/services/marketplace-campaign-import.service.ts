// Trendyol "Kampanyalar" katılım Excel'inin import servisi.
//
// İndirimler import'unun kardeşi, iki farkla: (1) sayfa ADI kampanyaya göre değiştiği için
// ilk sayfa sıraya göre okunur, (2) satırda katılım bir "Evet" kutusu değil bir FİYAT
// olduğundan iki fiyat kolonu (mevcut + maksimum) saklanır ve satıcının seçimi başta
// NONE'dır. Kampanya KURGUSU dosyada yoktur — multipart formdan gelir (doğrulaması
// ImportMarketplaceCampaignFormSchema'da) ve liste satırına yazılır. Ham dosya
// byte-koruyan export için saklanır.

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { readWorkbookGrid, SpreadsheetFileError, type SheetData } from '@pazarsync/spreadsheet';
import { Decimal } from 'decimal.js';

import { ValidationError } from '../lib/errors';
import { cellCurrencyDecimalString, cellText } from '../lib/xlsx-grid-cells';
import {
  CAMPAIGN_TARIFF_FLAG_YES,
  resolveMarketplaceCampaignLayout,
  type MarketplaceCampaignLayout,
} from './marketplace-campaign-layout';
import type { MarketplaceCampaignConfigFields } from '../validators/marketplace-campaign.validator';

/** Çözümlenmiş bir Excel ürün satırı. Para alanları 2 haneli string. */
export interface ParsedCampaignRow {
  readonly barcode: string;
  readonly productTitle: string;
  readonly productCode: string | null;
  readonly category: string | null;
  readonly brand: string | null;
  readonly color: string | null;
  readonly size: string | null;
  readonly stockCode: string | null;
  readonly stock: number | null;
  readonly currentPrice: string;
  readonly maxPrice: string;
  readonly hasCommissionTariff: boolean;
  readonly externalId: string | null;
}

/**
 * Bir Excel satırını çözer; satır kullanılabilir değilse null döner. Atlama kuralı:
 * barkod, mevcut fiyat ve maksimum fiyat üçü de OKUNABİLİR olmalı. Maksimum fiyat
 * zorunludur çünkü hem birinci fiyat seçeneği hem özel fiyatın tavanıdır — o olmadan
 * satır hiçbir şekilde kampanyaya katılamaz.
 */
function parseRow(
  row: readonly unknown[],
  layout: MarketplaceCampaignLayout,
): ParsedCampaignRow | null {
  const barcode = cellText(row, layout.barcode);
  if (barcode === null) return null;
  const currentPriceRaw = cellCurrencyDecimalString(row, layout.currentPrice);
  if (currentPriceRaw === null) return null;
  const maxPriceRaw = cellCurrencyDecimalString(row, layout.maxPrice);
  if (maxPriceRaw === null) return null;
  // Excel'in TL hücreleri kuruş hassasiyetinde (2 ondalık); hücre bir tamsayı olarak
  // gelse bile (örn. 249) burada 2 haneye normalize edilir — bilgi kaybı yok, yalnız
  // biçim (Decimal("249").toFixed(2) === "249.00"), "ara değer yuvarlaması" değil.
  // Bu adım yalnız `parseCampaignRows`'un KENDİ sözleşmesini (ParsedCampaignRow'un
  // "2 haneli string" belgesi) birim testte tutarlı kılmak için var — veri bütünlüğü
  // GARANTİSİ zaten hedef kolonda: `MarketplaceCampaignItem.currentPrice/maxPrice`
  // Prisma'da `Decimal(12,2)` olarak tanımlı, Postgres bu string'i yazsak da yazmasak
  // da AYNI 2 ondalığa yuvarlar. Yani buradaki toFixed(2) DB'nin zaten yapacağı işi
  // önden, pure-function seviyesinde görünür kılıyor — gerçek garanti şemada.
  const currentPrice = new Decimal(currentPriceRaw).toFixed(2);
  const maxPrice = new Decimal(maxPriceRaw).toFixed(2);

  const stockText = cellText(row, layout.stock);
  const stock = stockText !== null && /^\d+$/.test(stockText) ? Number(stockText) : null;

  return {
    barcode,
    // Barkod eşleşmese bile satır adı boş kalmasın diye barkoda düş.
    productTitle: cellText(row, layout.productTitle) ?? barcode,
    productCode: cellText(row, layout.productCode),
    category: cellText(row, layout.category),
    brand: cellText(row, layout.brand),
    color: cellText(row, layout.color),
    size: cellText(row, layout.size),
    stockCode: cellText(row, layout.stockCode),
    stock,
    currentPrice,
    maxPrice,
    hasCommissionTariff: cellText(row, layout.commissionTariffFlag) === CAMPAIGN_TARIFF_FLAG_YES,
    externalId: cellText(row, layout.externalId),
  };
}

/**
 * Izgarayı (başlık satırı dahil) çözümleyip kullanılabilir satırları ve atlanan satır
 * sayısını döner. Saf fonksiyon — veritabanına dokunmaz, birim testlenebilir. Export
 * tarafındaki `isImportedCampaignRow` bu atlama kuralıyla senkron kalmalıdır.
 */
export function parseCampaignRows(
  grid: SheetData,
  layout: MarketplaceCampaignLayout,
): { rows: ParsedCampaignRow[]; skippedRows: number } {
  const rows: ParsedCampaignRow[] = [];
  let skippedRows = 0;
  for (const row of grid.slice(1)) {
    const parsed = parseRow(row, layout);
    if (parsed === null) {
      skippedRows += 1;
      continue;
    }
    rows.push(parsed);
  }
  return { rows, skippedRows };
}

// ─── Giriş noktası ──────────────────────────────────────────────────────────

export interface ImportMarketplaceCampaignInput {
  organizationId: string;
  storeId: string;
  file: Buffer;
  filename: string;
  createdBy: string | null;
  name?: string;
  config: MarketplaceCampaignConfigFields;
}

export interface ImportMarketplaceCampaignResult {
  campaignId: string;
  name: string;
  itemCount: number;
  matched: number;
  unmatched: number;
  skippedRows: number;
}

const FALLBACK_CAMPAIGN_NAME = 'Kampanya';

function deriveName(input: ImportMarketplaceCampaignInput): string {
  const explicit = input.name?.trim();
  if (explicit !== undefined && explicit !== '') return explicit;
  const stem = input.filename.replace(/\.[^.]+$/, '').trim();
  return stem !== '' ? stem : FALLBACK_CAMPAIGN_NAME;
}

/** String config alanını Int kolonuna indirir (yoksa null). */
function intOrNull(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}

export async function importMarketplaceCampaign(
  input: ImportMarketplaceCampaignInput,
): Promise<ImportMarketplaceCampaignResult> {
  const { organizationId, storeId, config } = input;

  let grid: SheetData;
  try {
    // Sayfa adı kampanyaya göre değiştiği için `sheetName` BİLİNÇLİ OLARAK verilmez —
    // `readWorkbookGrid`'in sheetName'siz çağrıldığında ilk sayfayı (konuma göre)
    // okuması budur; `ReadGridOptions`'ta sayısal bir indeks alanı YOKTUR, o yüzden
    // "ilk sayfa" seçimi tek başına bu satırın sheetName GEÇMEMESİYLE sağlanır.
    // İndirimler'in `{ sheetName: DISCOUNT_SHEET_NAME }` (ada göre okuma) yaklaşımından
    // kasıtlı bir sapmadır — burada isim yok, sıra var.
    grid = await readWorkbookGrid(input.file);
  } catch (err) {
    if (err instanceof SpreadsheetFileError) {
      throw new ValidationError([{ field: 'file', code: err.code }]);
    }
    throw err;
  }

  if (grid.length < 2) {
    throw new ValidationError([{ field: 'file', code: 'EMPTY_CAMPAIGN_FILE' }]);
  }
  const layout = resolveMarketplaceCampaignLayout(grid[0] ?? []);
  if (layout === null) {
    throw new ValidationError([{ field: 'file', code: 'INVALID_CAMPAIGN_FORMAT' }]);
  }

  const { rows, skippedRows } = parseCampaignRows(grid, layout);
  if (rows.length === 0) {
    throw new ValidationError([{ field: 'file', code: 'EMPTY_CAMPAIGN_FILE' }]);
  }

  const distinctBarcodes = [...new Set(rows.map((r) => r.barcode))];
  const variants = await prisma.productVariant.findMany({
    where: { organizationId, storeId, barcode: { in: distinctBarcodes } },
    select: { id: true, barcode: true },
  });
  const variantByBarcode = new Map(variants.map((v) => [v.barcode, v.id]));
  const matched = rows.filter((r) => variantByBarcode.has(r.barcode)).length;

  const name = deriveName(input);

  try {
    const { campaignId, itemCount } = await prisma.$transaction(async (tx) => {
      const list = await tx.marketplaceCampaignList.create({
        data: {
          organizationId,
          storeId,
          name,
          discountType: config.discountType,
          valueKind: config.valueKind ?? null,
          value: config.value ?? null,
          minBasketAmount: config.minBasketAmount ?? null,
          minQuantity: intOrNull(config.minQuantity),
          buyQuantity: intOrNull(config.buyQuantity),
          payQuantity: intOrNull(config.payQuantity),
          nthIndex: intOrNull(config.nthIndex),
          trendyolFundingPct: config.trendyolFundingPct ?? '0',
          startsAt: config.startsAt ?? null,
          endsAt: config.endsAt ?? null,
          sourceFilename: input.filename,
          sourceFile: new Uint8Array(input.file),
          createdBy: input.createdBy,
        },
      });

      const itemsData = rows.map((r, index) => ({
        organizationId,
        storeId,
        listId: list.id,
        productVariantId: variantByBarcode.get(r.barcode) ?? null,
        barcode: r.barcode,
        productTitle: r.productTitle,
        productCode: r.productCode,
        category: r.category,
        brand: r.brand,
        color: r.color,
        size: r.size,
        stockCode: r.stockCode,
        stock: r.stock,
        externalId: r.externalId,
        currentPrice: r.currentPrice,
        maxPrice: r.maxPrice,
        hasCommissionTariff: r.hasCommissionTariff,
        sortOrder: index,
      }));
      await tx.marketplaceCampaignItem.createMany({ data: itemsData });
      return { campaignId: list.id, itemCount: itemsData.length };
    });

    return {
      campaignId,
      name,
      itemCount,
      matched,
      unmatched: rows.length - matched,
      skippedRows,
    };
  } catch (err) {
    mapPrismaError(err);
  }
}
