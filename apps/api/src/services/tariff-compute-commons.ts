// Shared compute primitives for the campaign tariff features (Ürün Komisyon +
// Plus Komisyon). Both features price a variant by REUSING the Ürün Fiyatlandırma
// assembly (`assembleUnitEconomics` + `computeUnitProfit`) and OVERRIDING only the
// commission — everything else (cost, shipping, PSF, stoppage, VAT) is identical.
// This module holds the pieces that are byte-for-byte the same across both.

import type { Decimal } from 'decimal.js';

import type { Platform, Prisma } from '@pazarsync/db';
import type { EstimateOutcome } from '@pazarsync/profit';

import type { ResolvedFeeDefs } from './product-pricing.service';
import type { ResolvedCommissionRate } from './commission-rate-resolver';

// ─── Why an item cannot be costed ───────────────────────────────────────────

export type TariffItemReason = 'NO_PRODUCT' | 'NO_COST' | 'NO_SHIPPING';

/** Cost gates first (margin/profit would be wrong at cost=0), then shipping. */
export function deriveReason(costOk: boolean, shippingOk: boolean): TariffItemReason {
  if (!costOk) return 'NO_COST';
  if (!shippingOk) return 'NO_SHIPPING';
  // Commission is always supplied externally (from the Excel), so calculability
  // can only fail on cost or shipping; default defensively to NO_COST.
  return 'NO_COST';
}

// A variant the CTE/cost resolvers could not place degrades to not-calculable.
export const NO_SHIPPING: EstimateOutcome = { ok: false, reason: 'STORE_NOT_FOUND' };

// The exact variant columns `assembleUnitEconomics` reads (mirrors its private
// `VariantForAssembly`). Supplied by the caller after the barcode → variant join.
export interface TariffVariant {
  readonly id: string;
  readonly stockCode: string;
  readonly barcode: string;
  readonly salePrice: Prisma.Decimal;
  readonly vatRate: number | null;
  readonly isDigital: boolean;
  readonly product: { title: string; categoryId: bigint | null; brandId: bigint | null };
}

export interface TariffAssemblyContext {
  readonly platform: Platform;
  readonly feeDefs: ResolvedFeeDefs;
}

/**
 * Synthesizes the `ResolvedCommissionRate` the pure assembly consumes from a raw
 * PERCENT (e.g. 19, 15.4). The tariff sources its commission from the Excel, not
 * the rate table, so `ruleSource` / `paymentTermDays` / `segmentApplied` are inert
 * here — `assembleUnitEconomics` reads only `.rate`. Kept explicit (no assertion)
 * so the shape stays in lockstep with the resolver's interface.
 */
export function tariffCommission(ratePercent: Decimal): ResolvedCommissionRate {
  return { rate: ratePercent, paymentTermDays: 0, ruleSource: 'category', segmentApplied: null };
}
