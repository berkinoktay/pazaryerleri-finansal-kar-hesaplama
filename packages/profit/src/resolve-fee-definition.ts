/**
 * FeeDefinition lookup helper — pazaryeri × feeType başına aktif tanımı
 * çözer (design §3.4 effectiveFrom/effectiveTo zaman bazlı sürümleme).
 *
 * Seed satırları (FeeScope kapsamıyla): TRENDYOL → PLATFORM_SERVICE 10.99,
 * PLATFORM_SERVICE_FAST 6.99, RETURN_SHIPPING, SHIPPING; ALL → STOPPAGE %1,
 * COMMISSION_INVOICE (komisyon KDV oranı %20, denetim A). Pazaryeri-bağımsız
 * ücretler 'ALL' kapsamında; oran değişirse yeni effectiveFrom row eklenir
 * (eski'nin effectiveTo set'lenir); bu fonksiyon `at` tarihine göre doğru
 * sürümü seçer.
 *
 * `applyEstimateOnOrderCreate` çağırır: PSF + Stopaj için `at = order.orderDate`.
 */

import type { OrderFeeType, Platform, Prisma } from '@pazarsync/db';

export class FeeDefinitionNotFoundError extends Error {
  constructor(
    public readonly platform: Platform,
    public readonly feeType: OrderFeeType,
  ) {
    super(`No active FeeDefinition for ${platform}/${feeType}`);
    this.name = 'FeeDefinitionNotFoundError';
  }
}

interface ResolveArgs {
  platform: Platform;
  feeType: OrderFeeType;
  /** Aktif tanım için tarih — typically order.orderDate. */
  at: Date;
}

export async function resolveFeeDefinition(tx: Prisma.TransactionClient, args: ResolveArgs) {
  // Kapsam: spesifik pazaryeri (args.platform) VEYA pazaryeri-bağımsız 'ALL'
  // (denetim A — stopaj + komisyon KDV gibi tüm pazaryerlerinde sabit ücretler
  // FeeScope.ALL satırında yaşar). Bir feeType ya spesifik ya ALL'dır (ikisi
  // birden değil) → `in` tek satır döndürür. args.platform tipi `Platform`
  // ('TRENDYOL'|'HEPSIBURADA') olup `FeeScope`'a atanabilir; 'ALL' da FeeScope.
  //
  // effectiveFrom <= at AND (effectiveTo IS NULL OR at < effectiveTo).
  // Sıralama: en güncel effectiveFrom kazanır; eşitlikte `platform: 'asc'` ile
  // spesifik pazaryeri (enum tanım sırasında ALL'dan önce) ALL'ı geçer — ileride
  // bir feeType hem spesifik hem ALL satır taşırsa spesifik tercih edilsin diye
  // defansif tiebreak.
  const def = await tx.feeDefinition.findFirst({
    where: {
      platform: { in: [args.platform, 'ALL'] },
      feeType: args.feeType,
      effectiveFrom: { lte: args.at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: args.at } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { platform: 'asc' }],
  });

  if (def === null) {
    throw new FeeDefinitionNotFoundError(args.platform, args.feeType);
  }
  return def;
}

/**
 * Platform Hizmet Bedeli muafiyet kuralı:
 *   - micro === true (mikro ihracat) → PSF = 0
 *   - Tüm OrderItem.productVariant.isDigital === true → PSF = 0
 *
 * İADE NOTU (Berkin kararı 2026-06-20): RETURNED durumu PSF'yi MUAF ETMEZ.
 * PSF siparişin ilk anında BİR KEZ kesilir ve sipariş iade olsa da x1 kalır
 * (asla x2 olmaz — tek PLATFORM_SERVICE ESTIMATE satırı, skip-if-exists). Otoritatif
 * kuraldaki "iade paketinde PSF uygulanmaz" = iade paketi İKİNCİ bir PSF doğurmaz;
 * orijinal x1 durur. Eski `status === 'RETURNED' → 0` dalı bu kuralla çelişiyordu
 * (sıfırdan-RETURNED siparişte PSF'yi yanlışlıkla siliyordu) → kaldırıldı. profit-formula.md §2.4.
 *
 * `applyEstimateOnOrderCreate` PSF OrderFee yazmadan önce kontrol eder.
 */
interface OrderForPsfExempt {
  micro: boolean;
  items: Array<{
    productVariant: { isDigital: boolean } | null;
  }>;
}

export function isPsfExempt(order: OrderForPsfExempt): boolean {
  if (order.micro === true) return true;
  if (order.items.length === 0) return false;
  return order.items.every((item) => item.productVariant?.isDigital === true);
}

/**
 * Mikro ihracat (Trendyol marketplace `micro=true`) ayırt edici yordamı —
 * `isPsfExempt`'in kardeşi. Mikro ihracat finansal modeli normal siparişten ayrılır:
 *   - Satış KDV'si %0 (ihracat istisnası 3065/11-1-a) — kaynakta sıfırlanır (upsert-order).
 *   - PSF uygulanmaz (yukarıda `isPsfExempt` zaten true döner).
 *   - "Uluslararası Hizmet Bedeli" (%6) kesilir; iadede "Yurt Dışı İade Operasyon Bedeli".
 *   - Komisyon + kargo Türkiye içiyle AYNI (değişmez).
 * Tek doğruluk kaynağı: tüm kâr yolları (estimate/settled/breakdown/claim) bunu çağırır.
 */
export function isMicroExport(order: { micro: boolean }): boolean {
  return order.micro === true;
}
