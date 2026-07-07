// Resolves the column layout of a Trendyol "Flaş Ürünler" (Teklif Ürünleri) sheet
// from its header row. Every column is resolved BY HEADER NAME so a future reorder
// does not silently shift the mapping. Shared by the import (read) and export
// (patch) paths so both agree on where a given column lives.
//
// Closest sibling is the Advantage layout (single block, NO periods), but the
// headers here are Title Case ("Barkod", "Mevcut Fiyat"), NOT the Advantage sheet's
// ALL-CAPS — `normalizeHeader` does not change case, so the names below are matched
// verbatim. Unlike the tariff sheets a row carries its OWN offer windows (24h + 3h)
// with per-row start/end dates; the reduced commission is looked up from the
// seller's Commission Tariff at compute time (see the flash compute service).

import { findHeader, normalizeHeader } from '../lib/xlsx-grid-cells';

export interface FlashProductLayout {
  // Identity + stock.
  readonly modelCode: number;
  readonly barcode: number;
  readonly productTitle: number;
  readonly category: number;
  readonly brand: number;
  readonly stock: number;
  // Current pricing: Mevcut Fiyat (TSF), Müşterinin Gördüğü Fiyat, Mevcut Komisyon %.
  readonly currentPrice: number;
  readonly customerPrice: number;
  readonly currentCommission: number;
  // Export write-back targets (resolved but NOT required at import; export skips a
  // -1 target). "Güncellenecek Fiyat" carries the participation label, "Senin
  // Belirlediğin Flaş Fiyatı" the numeric custom price.
  readonly updatedPrice: number;
  readonly customFlashPrice: number;
  // 24-hour offer: price + window start/end.
  readonly offer24Price: number;
  readonly offer24Start: number;
  readonly offer24End: number;
  // 3-hour offer: price + window start/end.
  readonly offer3Price: number;
  readonly offer3Start: number;
  readonly offer3End: number;
  // "Ürün Komisyon Tarife Seçeneği" = Var/- — does the product have a commission tariff.
  readonly commissionTariffFlag: number;
  // "Kampanyalı Ürün" — kept verbatim for display / export fidelity.
  readonly campaignedProduct: number;
  // Passthrough Trendyol "Ürün Id".
  readonly externalId: number;
}

/**
 * Resolves the Flash layout from the header row, or returns null when the sheet is
 * not a recognizable Trendyol Flash export (a required column is missing). The
 * caller turns null into INVALID_FLASH_FORMAT.
 */
export function resolveFlashProductLayout(
  headerRow: readonly unknown[],
): FlashProductLayout | null {
  const headers = headerRow.map(normalizeHeader);
  const col = (name: string): number => findHeader(headers, name);

  const layout: FlashProductLayout = {
    modelCode: col('Model Kodu'),
    barcode: col('Barkod'),
    productTitle: col('Ürün Adı'),
    category: col('Kategori'),
    brand: col('Marka'),
    stock: col('Stok'),
    currentPrice: col('Mevcut Fiyat'),
    customerPrice: col('Müşterinin Gördüğü Fiyat'),
    currentCommission: col('Mevcut Komisyon'),
    updatedPrice: col('Güncellenecek Fiyat'),
    customFlashPrice: col('Senin Belirlediğin Flaş Fiyatı'),
    offer24Price: col('24 Saat Fiyat'),
    offer24Start: col('24 Saat Flaş Başlangıç Tarihi'),
    offer24End: col('24 Saat Flaş Bitiş Tarihi'),
    offer3Price: col('3 Saat Fiyat'),
    offer3Start: col('3 Saat Flaş Başlangıç Tarihi'),
    offer3End: col('3 Saat Flaş Bitiş Tarihi'),
    commissionTariffFlag: col('Ürün Komisyon Tarife Seçeneği'),
    campaignedProduct: col('Kampanyalı Ürün'),
    externalId: col('Ürün Id'),
  };

  // Required for a usable Flash sheet: identity + the current pricing that anchors
  // the baseline + BOTH offer price columns (a row's offer presence is read from
  // these). The window date columns are NOT required — an absent/unparseable window
  // just yields a null-dated offer. The export-target columns (updatedPrice,
  // customFlashPrice) are resolved but not required — export just skips a -1 target.
  const required = [
    layout.barcode,
    layout.currentPrice,
    layout.customerPrice,
    layout.currentCommission,
    layout.offer24Price,
    layout.offer3Price,
  ];
  if (required.some((idx) => idx < 0)) return null;

  return layout;
}
