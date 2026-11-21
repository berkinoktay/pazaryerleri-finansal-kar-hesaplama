/**
 * Shipping-config service.
 *
 * Per spec §6.2 / §6.5 (docs/superpowers/specs/2026-05-17-shipping-cost-estimation-design.md):
 * read + update the per-store shipping configuration (tariff source + default
 * carrier), list global carriers (read-only, optionally filtered by platform),
 * and list the org-private OWN_CONTRACT tariff rows (V1: always empty).
 *
 * Tenant isolation: every store-scoped lookup includes `organizationId` in
 * the WHERE clause so a member of org A cannot reach a store owned by org B.
 * Missing store → NotFoundError (404) instead of a cross-tenant existence
 * disclosure.
 *
 * Cross-platform guard: a TRENDYOL store cannot be wired to a HEPSIBURADA
 * carrier (or vice-versa). Mismatch → `ShippingCarrierPlatformMismatchError`
 * with a stable wire code so the frontend can render a specific message.
 *
 * All callers must pass a `Prisma.TransactionClient` — the route handlers
 * open the transaction with `prisma.$transaction(tx => …)` so the read +
 * write happen on the same connection (and so future RLS-scoped writes can
 * piggy-back on the same SET LOCAL session).
 */

import type { z } from '@hono/zod-openapi';

import { mapPrismaError } from '@pazarsync/sync-core';

import type {
  Platform,
  Prisma,
  ShippingCarrier,
  ShippingTariffVersion,
  Store,
} from '@pazarsync/db';
import { BaremTier } from '@pazarsync/db/enums';
import { loadShippingTariffVersion } from '@pazarsync/profit';

import { NotFoundError, ShippingCarrierPlatformMismatchError } from '../lib/errors';
import type {
  ShippingCarrierSchema,
  UpdateShippingConfigInput,
} from '../validators/shipping-config.validator';

/**
 * A carrier row read with `tariffVersionInForceInclude`: `tariffVersions` holds the
 * tariff version in force at the read instant, or is empty when none is in force.
 */
export type ShippingCarrierWithVersion = ShippingCarrier & {
  tariffVersions: ShippingTariffVersion[];
};

/**
 * Carrier include that loads only the tariff version in force at `now`: the
 * latest effectiveFrom <= now. Every carrier read in this service uses it so the
 * Barem attributes in the response come from the version, not the carrier row.
 */
function tariffVersionInForceInclude(now: Date) {
  return {
    tariffVersions: {
      where: { effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
    },
  } satisfies Prisma.ShippingCarrierInclude;
}

/**
 * Maps a carrier row to the wire shape exposed by the API.
 * Centralised so all four shipping routes serialize identically — drift here
 * (e.g. a field added on the schema but not in one of the route handlers)
 * would silently produce inconsistent payloads across endpoints. The Barem
 * attributes come from the tariff version in force; a carrier with no version
 * in force reports no Barem support (false / 0).
 */
export function toCarrierResponse(
  c: ShippingCarrierWithVersion,
): z.infer<typeof ShippingCarrierSchema> {
  const version = c.tariffVersions.at(0);
  return {
    id: c.id,
    platform: c.platform,
    externalId: c.externalId,
    code: c.code,
    displayName: c.displayName,
    supportsBaremDestek: version?.supportsBaremDestek ?? false,
    maxBaremDesi: version?.maxBaremDesi ?? 0,
    sortOrder: c.sortOrder,
  };
}

export async function getShippingConfig(
  orgId: string,
  storeId: string,
  tx: Prisma.TransactionClient,
): Promise<{
  shippingTariffSource: Store['shippingTariffSource'];
  defaultShippingCarrier: ShippingCarrierWithVersion | null;
}> {
  const now = new Date();
  const store = await tx.store.findFirst({
    where: { id: storeId, organizationId: orgId },
    include: { defaultShippingCarrier: { include: tariffVersionInForceInclude(now) } },
  });
  if (!store) throw new NotFoundError('Store', storeId);
  return {
    shippingTariffSource: store.shippingTariffSource,
    defaultShippingCarrier: store.defaultShippingCarrier,
  };
}

export async function updateShippingConfig(
  orgId: string,
  storeId: string,
  input: UpdateShippingConfigInput,
  tx: Prisma.TransactionClient,
): Promise<Store & { defaultShippingCarrier: ShippingCarrierWithVersion | null }> {
  const now = new Date();
  const store = await tx.store.findFirst({ where: { id: storeId, organizationId: orgId } });
  if (!store) throw new NotFoundError('Store', storeId);

  if (input.defaultShippingCarrierId !== null) {
    // Filter on `active: true` so a deactivated carrier id cannot be wired in
    // post-hoc — `listShippingCarriers` already hides inactive rows from the
    // UI, but the API must reject the same id symmetrically on write.
    const carrier = await tx.shippingCarrier.findFirst({
      where: { id: input.defaultShippingCarrierId, active: true },
    });
    if (!carrier) throw new NotFoundError('ShippingCarrier', input.defaultShippingCarrierId);
    if (carrier.platform !== store.platform) {
      throw new ShippingCarrierPlatformMismatchError({
        expected: store.platform,
        got: carrier.platform,
      });
    }
  }

  try {
    const updated = await tx.store.update({
      where: { id: storeId },
      data: {
        shippingTariffSource: input.shippingTariffSource,
        defaultShippingCarrierId: input.defaultShippingCarrierId,
      },
      include: { defaultShippingCarrier: { include: tariffVersionInForceInclude(now) } },
    });
    // A stored order keeps the tariff source captured at intake, so the change
    // reaches only new orders and the catalog estimate; no stored order is queued.
    return updated;
  } catch (err) {
    mapPrismaError(err);
  }
}

export async function listShippingCarriers(
  filters: { platform?: Platform },
  tx: Prisma.TransactionClient,
): Promise<ShippingCarrierWithVersion[]> {
  const now = new Date();
  return tx.shippingCarrier.findMany({
    where: { active: true, ...(filters.platform ? { platform: filters.platform } : {}) },
    orderBy: { sortOrder: 'asc' },
    include: tariffVersionInForceInclude(now),
  });
}

export async function listOwnShippingTariff(
  orgId: string,
  storeId: string,
  tx: Prisma.TransactionClient,
): Promise<Array<{ id: string; desi: number; priceNet: Prisma.Decimal }>> {
  const store = await tx.store.findFirst({ where: { id: storeId, organizationId: orgId } });
  if (!store) throw new NotFoundError('Store', storeId);
  return tx.ownShippingTariff.findMany({
    where: { storeId },
    orderBy: { desi: 'asc' },
  });
}

/**
 * Returns the desi-based (NORMAL lane) tariff rows plus the Barem
 * destek table 1 bands for a single carrier, from its tariff version in
 * force now (both lists empty when no version is in force). Table 2 bands
 * are not returned: the store settings screen shows table 1 only. The tariff
 * data itself is platform-wide reference (not tenant-scoped), but
 * membership is still required to keep the endpoint behind the same
 * authz boundary as the rest of `/v1/organizations/{orgId}/...`.
 *
 * Hides inactive carriers symmetrically with `listShippingCarriers` so
 * a deactivated id cannot be peeked at via this endpoint. Returns 404
 * when no active carrier matches — existence non-disclosure for
 * deactivated rows is consistent with the rest of the surface.
 */
export async function getCarrierTariffs(
  carrierId: string,
  tx: Prisma.TransactionClient,
): Promise<{
  carrier: ShippingCarrierWithVersion;
  desiTariffs: Array<{ desi: number; priceNet: Prisma.Decimal }>;
  baremTariffs: Array<{
    minOrderAmount: Prisma.Decimal;
    maxOrderAmount: Prisma.Decimal;
    priceNet: Prisma.Decimal;
  }>;
}> {
  const now = new Date();
  const carrier = await tx.shippingCarrier.findFirst({
    where: { id: carrierId, active: true },
    include: tariffVersionInForceInclude(now),
  });
  if (!carrier) throw new NotFoundError('ShippingCarrier', carrierId);

  // The rows come from the engine's own "version in force" read (desi ascending,
  // Barem lower bound ascending), at the instant the carrier read above used.
  // Sequential with that read: this runs on a transaction client.
  const version = await loadShippingTariffVersion(tx, { carrierId, at: now });
  if (version === null) return { carrier, desiTariffs: [], baremTariffs: [] };

  return {
    carrier,
    desiTariffs: version.desiRows.map((row) => ({ desi: row.desi, priceNet: row.priceNet })),
    baremTariffs: version.baremRows
      .filter((row) => row.tier === BaremTier.TABLE_1)
      .map((row) => ({
        minOrderAmount: row.minOrderAmount,
        maxOrderAmount: row.maxOrderAmount,
        priceNet: row.priceNet,
      })),
  };
}
