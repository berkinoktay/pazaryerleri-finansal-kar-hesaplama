import Decimal from 'decimal.js';

/**
 * Input shape for computing the live current TRY equivalent of a cost profile.
 *
 * All monetary values are string decimals (per project convention: Decimal.js
 * end-to-end, never floating point). `fxRate` is the latest AUTO rate from the
 * TCMB cron — callers pass null when unavailable.
 */
export interface ComputeCurrentCostTryInput {
  /** Net amount in the profile's native currency (string decimal). */
  amount: string;
  /** ISO currency code — TRY | USD | EUR. */
  currency: 'TRY' | 'USD' | 'EUR';
  /** FX rate mode selected on the profile. */
  fxRateMode: 'AUTO' | 'MANUAL';
  /**
   * The profile's manually-set FX rate (string decimal), or null.
   * Required and respected when `fxRateMode === 'MANUAL'`.
   */
  manualFxRate: string | null;
  /**
   * Latest AUTO FX rate fetched from TCMB cron (string decimal), or null
   * when unavailable. Used only when `fxRateMode === 'AUTO'` and `currency !== 'TRY'`.
   */
  fxRate: string | null;
}

/**
 * Computes the current TRY equivalent of a cost profile's amount.
 *
 * Returns null when the conversion cannot be performed (e.g. AUTO mode with no
 * FX rate available). Callers render a "rate unavailable" message in that case.
 *
 * Rules (mirrors the backend spec §5.3 `resolveFxRateForSnapshot`):
 *   - TRY native → amount × 1 (always computable)
 *   - MANUAL → amount × manualFxRate (always computable when manualFxRate is set)
 *   - AUTO + fxRate available → amount × fxRate
 *   - AUTO + fxRate null → null (cannot compute)
 */
export function computeCurrentCostTry(input: ComputeCurrentCostTryInput): Decimal | null {
  const { amount, currency, fxRateMode, manualFxRate, fxRate } = input;
  const decimalAmount = new Decimal(amount);

  if (currency === 'TRY') {
    return decimalAmount;
  }

  if (fxRateMode === 'MANUAL') {
    if (manualFxRate === null) return null;
    return decimalAmount.mul(new Decimal(manualFxRate));
  }

  // AUTO mode
  if (fxRate === null) return null;
  return decimalAmount.mul(new Decimal(fxRate));
}
