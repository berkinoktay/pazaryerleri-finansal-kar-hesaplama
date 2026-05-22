/**
 * Cost snapshot capture service.
 *
 * Per spec §5.2. Called from the marketplace sync worker after each
 * OrderItem INSERT. Runs inside the same transaction as the INSERT so the
 * snapshot and its components are written atomically.
 *
 * KDV-split convention (PR-6 continuation, 2026-05-21): writes the three
 * NET split columns (`unitCostSnapshotNet`, `unitCostSnapshotVatAmount`,
 * `unitCostSnapshotVatRate`). The legacy single-column `unitCostSnapshot`
 * (KDV-dahil) stays NULL — profit-formula reads NET, no consumer remains
 * on the legacy column. Drop is scheduled for PR-8+ (PR-5c pattern).
 *
 * Key invariants (spec §5.7):
 *   1. App layer: throws SnapshotAlreadyCapturedError if unitCostSnapshotNet != null.
 *   2. DB layer: the `order_items_snapshot_immutable` trigger rejects any
 *      UPDATE that changes the snapshot columns once they are non-null.
 *
 * Best-effort on FX failure: if resolveFxRateForSnapshot returns null
 * (no rate in DB), the function logs a warning and exits without writing —
 * the snapshot stays null forever (spec §5.8 row 3).
 */

import { Decimal } from 'decimal.js';

import type { CostProfileType, Currency, FxRateMode, Prisma } from '@pazarsync/db';

import { resolveFxRateForSnapshot } from './fx-rates.service';

// ─── Error ───────────────────────────────────────────────────────────────────

/**
 * Thrown when captureCostSnapshot is called on an OrderItem that already
 * has a non-null unitCostSnapshotNet. Signals a coding error in the caller
 * (should only call after a fresh INSERT, never on existing items).
 */
export class SnapshotAlreadyCapturedError extends Error {
  readonly code = 'SNAPSHOT_ALREADY_CAPTURED' as const;

  constructor(orderItemId: string) {
    super(`OrderItem ${orderItemId} already has a unit_cost_snapshot — snapshots are write-once`);
    this.name = 'SnapshotAlreadyCapturedError';
  }
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface SnapshotComponentData {
  orderItemId: string;
  organizationId: string;
  profileId: string;
  profileName: string;
  profileType: CostProfileType;
  amount: Decimal;
  currency: Currency;
  vatRate: number;
  amountInTry: Decimal;
  // PR-6 continuation: KDV snapshot in native currency + TRY.
  // `amount = NET` convention; canonical formula `vatAmount = amount × vatRate / 100`.
  vatAmount: Decimal;
  vatAmountInTry: Decimal;
  fxRateMode: FxRateMode;
  fxRateUsed: Decimal;
  fxRateSource: string;
}

// ─── Service function ─────────────────────────────────────────────────────────

/**
 * Capture the cost snapshot for a single OrderItem.
 *
 * @param orderItemId - ID of the freshly-inserted OrderItem
 * @param tx          - Active Prisma transaction client
 */
export async function captureCostSnapshot(
  orderItemId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const item = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    include: { productVariant: true },
  });

  if (!item) {
    // Should not happen in practice (called immediately after INSERT), but
    // guard defensively rather than throw — leaving snapshot null is safe.
    console.warn({ orderItemId }, '[captureCostSnapshot] orderItem not found, skipping');
    return;
  }

  // App-layer write-once guard (spec §5.7 layer 1)
  if (item.unitCostSnapshotNet !== null) {
    throw new SnapshotAlreadyCapturedError(orderItemId);
  }

  // Unattributed line item (no variant link) — leave snapshot null
  if (!item.productVariantId) {
    return;
  }

  // Load active cost profiles attached to this variant
  const links = await tx.productVariantCostProfile.findMany({
    where: { productVariantId: item.productVariantId },
    include: { profile: true },
  });

  const activeProfiles = links.map((l) => l.profile).filter((p) => p.archivedAt === null);

  // No profiles → snapshot stays null → order profit stays null
  if (activeProfiles.length === 0) {
    return;
  }

  // Resolve FX rates and build component rows
  const components: SnapshotComponentData[] = [];

  for (const profile of activeProfiles) {
    const fx = await resolveFxRateForSnapshot(profile, tx);

    if (fx === null) {
      // Best-effort: FX rate unavailable, abort snapshot (spec §5.8 row 3)
      console.warn(
        { orderItemId, profileId: profile.id, currency: profile.currency },
        '[captureCostSnapshot] FX rate unavailable — snapshot aborted, will stay null',
      );
      return;
    }

    // KDV split — `profile.amount` is NET (schema convention, PR-4 backfill formula).
    // `profile.vatAmount` is nullable when cost-profile.service does not
    // backfill on create/update (TODO: see master guide §Current Status).
    // Defensive compute via canonical formula when null.
    const amountNet = new Decimal(profile.amount);
    const vatAmountNative =
      profile.vatAmount !== null
        ? new Decimal(profile.vatAmount)
        : amountNet.mul(profile.vatRate).div(100);

    components.push({
      orderItemId,
      organizationId: item.organizationId ?? '',
      profileId: profile.id,
      profileName: profile.name,
      profileType: profile.type,
      amount: amountNet,
      currency: profile.currency,
      vatRate: profile.vatRate,
      amountInTry: amountNet.mul(fx.rate),
      vatAmount: vatAmountNative,
      vatAmountInTry: vatAmountNative.mul(fx.rate),
      fxRateMode: profile.fxRateMode,
      fxRateUsed: fx.rate,
      fxRateSource: fx.source,
    });
  }

  // Aggregate NET + VAT (in TRY) across all profiles. Effective vatRate is
  // denormalized for downstream consumers — multi-profile case with mixed
  // rates surfaces a blended rate; single-profile case lands the original rate.
  const unitCostSnapshotNet = components
    .reduce((acc, c) => acc.add(c.amountInTry), new Decimal(0))
    .toDecimalPlaces(2);
  const unitCostSnapshotVatAmount = components
    .reduce((acc, c) => acc.add(c.vatAmountInTry), new Decimal(0))
    .toDecimalPlaces(2);
  // NET=0 means no priced cost — rate is undefined, not 0% (0% is a valid
  // rate for export/exempt goods, so writing `0` here would alias the two
  // states for downstream consumers). Leave the denormalized rate NULL.
  const unitCostSnapshotVatRate = unitCostSnapshotNet.isZero()
    ? null
    : unitCostSnapshotVatAmount.div(unitCostSnapshotNet).mul(100).toDecimalPlaces(2);

  // Write snapshot and components atomically (same tx). Legacy
  // `unitCostSnapshot` stays NULL — profit-formula reads NET, no consumer
  // remains on the legacy column. Drop scheduled for PR-8+ (PR-5c pattern).
  await tx.orderItem.update({
    where: { id: orderItemId },
    data: {
      unitCostSnapshotNet,
      unitCostSnapshotVatAmount,
      unitCostSnapshotVatRate,
      snapshotCapturedAt: new Date(),
    },
  });

  await tx.orderItemCostSnapshotComponent.createMany({ data: components });
}
