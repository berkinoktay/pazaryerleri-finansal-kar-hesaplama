/**
 * Dated shipping tariff read. A carrier's tariff is a series of versions: each one
 * holds the desi prices, the Barem bands and the Barem attributes that apply from its
 * `effectiveFrom` instant until the same carrier's next version starts. Only the start
 * is stored, so the version in force at an instant is the latest start on or before it.
 *
 * Read-only. Tariff versions are platform-global reference data, so the read carries
 * no tenant filter (the carrier id is the only scope). Money stays `Prisma.Decimal`.
 */

import type { Prisma } from '@pazarsync/db';
import type { BaremTier } from '@pazarsync/db/enums';

export interface ShippingTariffVersionRows {
  readonly versionId: string;
  readonly effectiveFrom: Date;
  readonly supportsBaremDestek: boolean;
  readonly maxBaremDesi: number;
  readonly maxBaremEligibleDeliveryDuration: number;
  // When true, the return of an order that went out at Barem table 1 is priced at
  // table 1; otherwise at the desi tariff. Off on every version today.
  readonly baremAppliesToReturns: boolean;
  readonly desiRows: ReadonlyArray<{
    readonly id: string;
    readonly desi: number;
    readonly priceNet: Prisma.Decimal;
  }>;
  readonly baremRows: ReadonlyArray<{
    readonly id: string;
    readonly tier: BaremTier;
    readonly minOrderAmount: Prisma.Decimal;
    readonly maxOrderAmount: Prisma.Decimal;
    readonly priceNet: Prisma.Decimal;
  }>;
}

/** The version of `carrierId` in force at `at`: the latest effectiveFrom <= at. Null when none. */
export async function loadShippingTariffVersion(
  tx: Prisma.TransactionClient,
  params: { readonly carrierId: string; readonly at: Date },
): Promise<ShippingTariffVersionRows | null> {
  const version = await tx.shippingTariffVersion.findFirst({
    where: { carrierId: params.carrierId, effectiveFrom: { lte: params.at } },
    orderBy: { effectiveFrom: 'desc' },
    include: {
      desiTariffs: { orderBy: { desi: 'asc' } },
      baremTariffs: { orderBy: { minOrderAmount: 'asc' } },
    },
  });
  if (version === null) {
    return null;
  }

  return {
    versionId: version.id,
    effectiveFrom: version.effectiveFrom,
    supportsBaremDestek: version.supportsBaremDestek,
    maxBaremDesi: version.maxBaremDesi,
    maxBaremEligibleDeliveryDuration: version.maxBaremEligibleDeliveryDuration,
    baremAppliesToReturns: version.baremAppliesToReturns,
    desiRows: version.desiTariffs.map((row) => ({
      id: row.id,
      desi: row.desi,
      priceNet: row.priceNet,
    })),
    baremRows: version.baremTariffs.map((row) => ({
      id: row.id,
      tier: row.tier,
      minOrderAmount: row.minOrderAmount,
      maxOrderAmount: row.maxOrderAmount,
      priceNet: row.priceNet,
    })),
  };
}
