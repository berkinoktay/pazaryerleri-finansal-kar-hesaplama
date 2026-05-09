/**
 * FX-rate resolution for cost snapshots.
 *
 * Per spec §5.3. Called from captureCostSnapshot — runs inside the sync
 * transaction so it uses the tx client, not the global prisma client.
 *
 * Branches (in priority order):
 *   TRY    → always 1, no DB read (cost is already in the target currency)
 *   MANUAL → use profile.manualFxRate (seller-supplied fixed rate)
 *   AUTO   → read the most recent fx_rates row for the currency
 *
 * Returns null when the AUTO rate is unavailable (no row in fx_rates).
 * The caller (captureCostSnapshot) logs a warning and leaves the snapshot null.
 */

import { Decimal } from 'decimal.js';

import type { CostProfile, Prisma } from '@pazarsync/db';

export interface FxResolution {
  /** Rate to multiply `profile.amount` by to get TRY value. */
  rate: Decimal;
  /**
   * Provenance string frozen into the snapshot component:
   *   'TRY-NATIVE'      — profile currency is TRY, rate is exactly 1
   *   'MANUAL'          — profile uses a seller-supplied fixed rate
   *   'TCMB-YYYY-MM-DD' — AUTO rate fetched from TCMB on the given date
   */
  source: string;
}

/**
 * Resolves the FX rate to apply when snapshotting a cost profile.
 *
 * @param profile - The cost profile being snapshotted
 * @param tx      - Active Prisma transaction (so the read is in the same tx)
 * @returns       FxResolution, or null when an AUTO rate is unavailable
 */
export async function resolveFxRateForSnapshot(
  profile: Pick<CostProfile, 'currency' | 'fxRateMode' | 'manualFxRate'>,
  tx: Prisma.TransactionClient,
): Promise<FxResolution | null> {
  if (profile.currency === 'TRY') {
    return { rate: new Decimal(1), source: 'TRY-NATIVE' };
  }

  if (profile.fxRateMode === 'MANUAL') {
    // Validator (PR 2) guarantees manualFxRate is non-null when mode is MANUAL.
    // The non-null assertion is safe; treat a null as a corrupted row and throw.
    if (profile.manualFxRate === null) {
      throw new Error(
        `Cost profile has fxRateMode=MANUAL but manualFxRate is null — data integrity violation`,
      );
    }
    return { rate: new Decimal(profile.manualFxRate), source: 'MANUAL' };
  }

  // AUTO: read the most-recent rate for this currency from the fx_rates table.
  const row = await tx.fxRate.findFirst({
    where: { currency: profile.currency },
    orderBy: { rateDate: 'desc' },
  });

  if (!row) {
    return null;
  }

  const dateStr = row.rateDate.toISOString().slice(0, 10);
  return { rate: new Decimal(row.rateToTry), source: `TCMB-${dateStr}` };
}
