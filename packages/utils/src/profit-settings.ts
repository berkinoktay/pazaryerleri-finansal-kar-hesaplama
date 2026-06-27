/**
 * Mağaza-bazlı kâr formülü ayarları — çözülmüş (default-uygulanmış) tam şekil ve çözücüler.
 *
 * İki tüketici: `apps/api` (store ayar servisi) ve `packages/profit` (estimate motoru,
 * snapshot yazarken/okurken). İki ayrı paket olduğu için ortak ev = `@pazarsync/utils`.
 *
 * SNAPSHOT-AT-CREATE: `Store.profitSettings` CANLI ayardır; sipariş ilk hesaplanırken
 * `resolveProfitSettings` ile çözülüp `Order.snapshot*` kolonlarına yazılır. Sonraki tüm
 * hesaplar `resolveSnapshotProfitSettings` ile snapshot'ı okur — canlı ayarı değil.
 */

/** Çözülmüş kâr formülü ayarları (her alan kesin boolean — default uygulanmış). */
export interface ResolvedProfitSettings {
  /** %1 e-ticaret stopajı net kârdan düşülsün mü? Varsayılan: true (mevcut davranış korunur). */
  includeStopaj: boolean;
  /**
   * Net KDV negatif çıktığında (KDV alacağı) kâra dahil edilsin mi? Varsayılan: false
   * (rakip ile aynı — alacak kârı şişirmez). Pozitif Net KDV bu ayardan bağımsız her zaman düşülür.
   */
  includeNegativeNetVat: boolean;
}

/** Mağaza ayarı boş/eksik olduğunda uygulanan varsayılanlar. */
export const DEFAULT_PROFIT_SETTINGS: ResolvedProfitSettings = {
  includeStopaj: true,
  includeNegativeNetVat: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `Store.profitSettings` (Prisma `Json` → `unknown`) ham değerini çözer. Eksik/bozuk/yanlış-tipli
 * anahtarlar sessizce ilgili varsayılana düşer (defansif — kullanıcı JSONB'ye ne yazarsa yazsın
 * motor geçerli bir ayar görür).
 */
export function resolveProfitSettings(raw: unknown): ResolvedProfitSettings {
  if (!isRecord(raw)) {
    return { ...DEFAULT_PROFIT_SETTINGS };
  }
  return {
    includeStopaj:
      typeof raw.includeStopaj === 'boolean'
        ? raw.includeStopaj
        : DEFAULT_PROFIT_SETTINGS.includeStopaj,
    includeNegativeNetVat:
      typeof raw.includeNegativeNetVat === 'boolean'
        ? raw.includeNegativeNetVat
        : DEFAULT_PROFIT_SETTINGS.includeNegativeNetVat,
  };
}

/**
 * Siparişe yazılmış snapshot kolonlarını çözer. `null` (snapshot henüz yazılmamış / kâr-dışı
 * sipariş) ilgili varsayılana düşer — geçmiş/snapshot'sız siparişler güvenle okunur.
 */
export function resolveSnapshotProfitSettings(snapshot: {
  snapshotIncludeStopaj: boolean | null;
  snapshotIncludeNegativeNetVat: boolean | null;
}): ResolvedProfitSettings {
  return {
    includeStopaj: snapshot.snapshotIncludeStopaj ?? DEFAULT_PROFIT_SETTINGS.includeStopaj,
    includeNegativeNetVat:
      snapshot.snapshotIncludeNegativeNetVat ?? DEFAULT_PROFIT_SETTINGS.includeNegativeNetVat,
  };
}
