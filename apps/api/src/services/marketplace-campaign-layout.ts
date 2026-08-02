// Trendyol "Kampanyalar" (Katılabileceğim Kampanyalar > Ürün Ekle) katılım sayfasının
// kolon dizilimini başlık satırından çözer. Her kolon BAŞLIK ADIYLA çözülür, böylece
// ileride bir sıra değişikliği eşlemeyi sessizce kaydırmaz. Import (okuma) ve export
// (yama) yolları aynı çözücüyü paylaşır, ikisi de kolonun nerede olduğunda anlaşır.
//
// KATI ŞABLON (Berkin kararı 2026-08-02): başlık kümesi zorunludur; eksik başlıkta
// yükleme net bir hatayla reddedilir. Farklı dizilimli bir kampanya dosyası çıkarsa
// ikinci bir şablon AYRI bir iş olarak eklenir — burada tolerans yok.
//
// Sayfa ADI kampanyaya göre değiştiği için sayfa SIRAYA göre okunur (ilk sayfa).

import { findHeader, normalizeHeader } from '../lib/xlsx-grid-cells';

/** "Ürün Komisyon Tarifesi" kolonunun ürüne tarife bağlı olduğunu belirten değeri. */
export const CAMPAIGN_TARIFF_FLAG_YES = 'Var';

export interface MarketplaceCampaignLayout {
  readonly barcode: number;
  readonly productTitle: number;
  readonly productCode: number;
  readonly category: number;
  readonly brand: number;
  readonly color: number;
  readonly size: number;
  readonly stockCode: number;
  readonly stock: number;
  readonly currentPrice: number;
  readonly maxPrice: number;
  /** "Kampanyalı Satış Fiyatı" — export'un yamaladığı TEK kolon. */
  readonly campaignPrice: number;
  readonly commissionTariffFlag: number;
  readonly externalId: number;
}

/**
 * Başlık satırından dizilimi çözer; dosya tanınabilir bir Trendyol Kampanyalar dışa
 * aktarımı değilse null döner. Çağıran bunu INVALID_CAMPAIGN_FORMAT'a çevirir.
 */
export function resolveMarketplaceCampaignLayout(
  headerRow: readonly unknown[],
): MarketplaceCampaignLayout | null {
  const headers = headerRow.map(normalizeHeader);
  const col = (name: string): number => findHeader(headers, name);

  const layout: MarketplaceCampaignLayout = {
    barcode: col('Barkod'),
    productTitle: col('Ürün Adı'),
    productCode: col('Ürün Kodu'),
    category: col('Kategori'),
    brand: col('Marka'),
    color: col('Renk'),
    size: col('Beden'),
    stockCode: col('Stok Kodu'),
    stock: col('Mevcut Stok'),
    currentPrice: col('Mevcut Satış Fiyatı'),
    maxPrice: col('Maksimum Girebileceğin Fiyat'),
    campaignPrice: col('Kampanyalı Satış Fiyatı'),
    commissionTariffFlag: col('Ürün Komisyon Tarifesi'),
    externalId: col('ListingId'),
  };

  // Katı şablon: 14 kolonun HEPSİ zorunlu. Kimlik (barkod), üç fiyat kolonu ve yazma
  // kolonu olmadan dikey zaten imkânsız; kalanlar da gösterim sözleşmesinin parçası.
  const required = Object.values(layout);
  if (required.some((idx) => idx < 0)) return null;

  return layout;
}
