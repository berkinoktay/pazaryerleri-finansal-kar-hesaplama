/**
 * FeeDefinition lookup helper — pazaryeri × feeType başına aktif tanımı
 * çözer (design §3.4 effectiveFrom/effectiveTo zaman bazlı sürümleme).
 *
 * PR-2 seed Trendyol için 4 satır yazdı (PLATFORM_SERVICE 10.99,
 * PLATFORM_SERVICE_FAST 6.99, STOPPAGE %1, RETURN_SHIPPING). Trendyol oranı
 * değişirse yeni effectiveFrom row eklenir (eski'nin effectiveTo set'lenir);
 * bu fonksiyon `at` tarihine göre doğru sürümü seçer.
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
  // effectiveFrom <= at AND (effectiveTo IS NULL OR at < effectiveTo).
  // En son effectiveFrom kazanır (Trendyol oran değişiminde overlap yok beklenir,
  // ama defansif olarak `orderBy` DESC ile en güncel sürüm seçilir).
  const def = await tx.feeDefinition.findFirst({
    where: {
      platform: args.platform,
      feeType: args.feeType,
      effectiveFrom: { lte: args.at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: args.at } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (def === null) {
    throw new FeeDefinitionNotFoundError(args.platform, args.feeType);
  }
  return def;
}

/**
 * Platform Hizmet Bedeli muafiyet kuralı (design §3.7):
 *   - status === 'RETURNED' → PSF = 0
 *   - micro === true (Trendyol Yurt Dışı Aracılığı) → PSF = 0
 *   - Tüm OrderItem.productVariant.isDigital === true → PSF = 0
 *
 * `applyEstimateOnOrderCreate` PSF OrderFee yazmadan önce kontrol eder.
 */
interface OrderForPsfExempt {
  status: string;
  micro: boolean;
  items: Array<{
    productVariant: { isDigital: boolean } | null;
  }>;
}

export function isPsfExempt(order: OrderForPsfExempt): boolean {
  if (order.status === 'RETURNED') return true;
  if (order.micro === true) return true;
  if (order.items.length === 0) return false;
  return order.items.every((item) => item.productVariant?.isDigital === true);
}
