// Resolves the column layout of a Trendyol "Avantajlı Ürün Etiketleri" (a.k.a.
// "Yıldızlı Ürün Etiketleri") sheet from its header row. Every column is resolved
// BY HEADER NAME (headers are ALL-CAPS in this export) so a future reorder does
// not silently shift the mapping. Shared by the import (read) and export (patch)
// paths so both agree on where a given column lives.
//
// Unlike the commission/plus sheets this file carries NO commission percentages
// and NO period dates — just the three star-tier price thresholds. The reduced
// commission is looked up from the seller's Commission Tariff at compute time
// (see advantage-tariff-compute.service.ts).

import { findHeader, normalizeHeader } from '../lib/xlsx-grid-cells';

export interface AdvantageTariffLayout {
  // Identity + stock.
  readonly productTitle: number;
  readonly barcode: number;
  readonly size: number;
  readonly modelCode: number;
  readonly category: number;
  readonly brand: number;
  readonly stock: number;
  // "KOMİSYON TARİFESİ" = Var/Yok — does the product have a commission tariff.
  readonly commissionTariffFlag: number;
  // The three star tiers (upper/lower); tier 3 has no lower ("ve altı").
  readonly tier1Upper: number;
  readonly tier1Lower: number;
  readonly tier2Upper: number;
  readonly tier2Lower: number;
  readonly tier3Upper: number;
  // Current pricing.
  readonly customerPrice: number;
  readonly currentPrice: number;
  // Export write-back targets (resolved but not required at import; export skips a
  // -1 target).
  readonly newTsf: number;
  readonly applyUntilEnd: number;
  // Passthrough identifiers.
  readonly externalId: number;
  readonly tariffGroup: number;
}

/**
 * Resolves the Advantage layout from the header row, or returns null when the
 * sheet is not a recognizable Trendyol Advantage export (a required column is
 * missing). The caller turns null into INVALID_ADVANTAGE_TARIFF_FORMAT.
 */
export function resolveAdvantageTariffLayout(
  headerRow: readonly unknown[],
): AdvantageTariffLayout | null {
  const headers = headerRow.map(normalizeHeader);
  const col = (name: string): number => findHeader(headers, name);

  const layout: AdvantageTariffLayout = {
    productTitle: col('ÜRÜN İSMİ'),
    barcode: col('BARKOD'),
    size: col('BEDEN'),
    modelCode: col('MODEL KODU'),
    category: col('KATEGORİ'),
    brand: col('MARKA'),
    stock: col('STOK'),
    commissionTariffFlag: col('KOMİSYON TARİFESİ'),
    tier1Upper: col('1 YILDIZ ÜST FİYAT'),
    tier1Lower: col('1 YILDIZ ALT FİYAT'),
    tier2Upper: col('2 YILDIZ ÜST FİYAT'),
    tier2Lower: col('2 YILDIZ ALT FİYAT'),
    tier3Upper: col('3 YILDIZ ÜST FİYAT'),
    customerPrice: col('MÜŞTERİNİN GÖRDÜĞÜ FİYAT'),
    currentPrice: col('TRENDYOL SATIŞ FİYATI'),
    newTsf: col('YENİ TSF (FİYAT GÜNCELLE)'),
    applyUntilEnd: col('Tarife Sonuna Kadar Uygula'),
    externalId: col('EXTERNAL ID'),
    tariffGroup: col('TARİFE GRUBU'),
  };

  // Required for a usable Advantage tariff: identity + the star thresholds + the
  // current price. The export-target columns (newTsf, applyUntilEnd) are resolved
  // but not required at import — export just skips a -1 target.
  const required = [
    layout.barcode,
    layout.currentPrice,
    layout.tier1Upper,
    layout.tier1Lower,
    layout.tier2Upper,
    layout.tier2Lower,
    layout.tier3Upper,
  ];
  if (required.some((idx) => idx < 0)) return null;

  return layout;
}
