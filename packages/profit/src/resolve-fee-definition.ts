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
 */

import type { FeeDefinition, OrderFeeType, Platform, Prisma } from '@pazarsync/db';

export class FeeDefinitionNotFoundError extends Error {
  constructor(
    public readonly platform: Platform,
    public readonly feeType: OrderFeeType,
  ) {
    super(`No active FeeDefinition for ${platform}/${feeType}`);
    this.name = 'FeeDefinitionNotFoundError';
  }
}

/** The amount column of a fee definition a used fee requires. */
export type FeeDefinitionAmountField = 'fixedAmountNet' | 'rateOfSale';

/**
 * A fee definition that a parcel or scenario actually uses exists for the date but
 * is missing the amount column it needs (a FIXED fee without `fixedAmountNet`, a
 * RATE_OF_SALE fee without `rateOfSale`).
 */
export class IncompleteFeeDefinitionError extends Error {
  constructor(
    public readonly feeType: OrderFeeType,
    public readonly field: FeeDefinitionAmountField,
  ) {
    super(`${feeType} fee definition is missing ${field}`);
    this.name = 'IncompleteFeeDefinitionError';
  }
}

interface ResolveArgs {
  platform: Platform;
  feeType: OrderFeeType;
  /** Aktif tanım için tarih — typically order.orderDate. */
  at: Date;
}

/**
 * The fee definition in force at `args.at`, or null when none covers the date. The
 * non-throwing lookup behind `resolveFeeDefinition`; the order loader uses it directly
 * so a missing definition becomes a recorded issue instead of an error.
 */
export async function findFeeDefinition(
  tx: Prisma.TransactionClient,
  args: ResolveArgs,
): Promise<FeeDefinition | null> {
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
  return tx.feeDefinition.findFirst({
    where: {
      platform: { in: [args.platform, 'ALL'] },
      feeType: args.feeType,
      effectiveFrom: { lte: args.at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: args.at } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { platform: 'asc' }],
  });
}

/** The fee definition in force at `args.at`; throws `FeeDefinitionNotFoundError` when none. */
export async function resolveFeeDefinition(
  tx: Prisma.TransactionClient,
  args: ResolveArgs,
): Promise<FeeDefinition> {
  const def = await findFeeDefinition(tx, args);
  if (def === null) {
    throw new FeeDefinitionNotFoundError(args.platform, args.feeType);
  }
  return def;
}
