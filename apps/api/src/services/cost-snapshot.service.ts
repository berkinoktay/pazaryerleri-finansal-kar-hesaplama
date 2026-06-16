/**
 * Cost snapshot capture service.
 *
 * Per spec §5.2. Called from the marketplace sync worker after each
 * OrderItem INSERT. Runs inside the same transaction as the INSERT so the
 * snapshot and its components are written atomically.
 *
 * GROSS convention (2026-06-16): reads CostProfile.amountGross + vatRate
 * (KDV-dahil), writes OrderItem.unitCostSnapshotGross + unitCostSnapshotVatRate.
 * Components carry amountGross + vatRate + amountInTryGross (FX path).
 * Cost VAT rate is independent of sale VAT rate (spec §7).
 *
 * Key invariants (spec §5.7):
 *   1. App layer: throws SnapshotAlreadyCapturedError if unitCostSnapshotGross != null.
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
 * has a non-null unitCostSnapshotGross. Signals a coding error in the caller
 * (should only call after a fresh INSERT, never on existing items).
 */
export class SnapshotAlreadyCapturedError extends Error {
  readonly code = 'SNAPSHOT_ALREADY_CAPTURED' as const;

  constructor(orderItemId: string) {
    super(
      `OrderItem ${orderItemId} already has a unit_cost_snapshot_gross — snapshots are write-once`,
    );
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
  amountGross: Decimal;
  currency: Currency;
  vatRate: number;
  amountInTryGross: Decimal;
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

  // App-layer write-once guard (spec §5.7 layer 1) — GROSS convention
  if (item.unitCostSnapshotGross !== null) {
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

    // GROSS convention: profile.amountGross is KDV-dahil.
    // amountInTryGross = amountGross × fxRate (gross stays gross across currencies).
    // Cost VAT rate is independent of sale VAT rate (spec §7).
    const amountGross = new Decimal(profile.amountGross);
    const vatRate = Number(profile.vatRate);

    components.push({
      orderItemId,
      organizationId: item.organizationId ?? '',
      profileId: profile.id,
      profileName: profile.name,
      profileType: profile.type,
      amountGross,
      currency: profile.currency,
      vatRate,
      amountInTryGross: amountGross.mul(fx.rate).toDecimalPlaces(2),
      fxRateMode: profile.fxRateMode,
      fxRateUsed: fx.rate,
      fxRateSource: fx.source,
    });
  }

  // Aggregate gross (in TRY) across all profiles.
  // unitCostSnapshotGross = Σ amountInTryGross (KDV-dahil toplam, TRY).
  // vatRate: the effective blended rate (single-profile → exact; multi-profile → blended).
  // For zero-gross case: vatRate stays null (undefined, not 0% which is a valid export rate).
  const unitCostSnapshotGross = components
    .reduce((acc, c) => acc.add(c.amountInTryGross), new Decimal(0))
    .toDecimalPlaces(2);

  // Blended effective vatRate = Σ(amountInTryGross × vatRate) / Σ(amountInTryGross)
  // Only meaningful when gross > 0 (zero-gross → null to distinguish from 0% exempt rate).
  let unitCostSnapshotVatRate: Decimal | null = null;
  if (!unitCostSnapshotGross.isZero()) {
    const weightedVatSum = components.reduce(
      (acc, c) => acc.add(c.amountInTryGross.mul(c.vatRate)),
      new Decimal(0),
    );
    unitCostSnapshotVatRate = weightedVatSum.div(unitCostSnapshotGross).toDecimalPlaces(2);
  }

  // Write snapshot and components atomically (same tx).
  await tx.orderItem.update({
    where: { id: orderItemId },
    data: {
      unitCostSnapshotGross,
      unitCostSnapshotVatRate,
      snapshotCapturedAt: new Date(),
    },
  });

  await tx.orderItemCostSnapshotComponent.createMany({ data: components });
}
