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

import type { Platform, Prisma, ShippingCarrier, Store } from '@pazarsync/db';

import { NotFoundError, ShippingCarrierPlatformMismatchError } from '../lib/errors';
import type {
  ShippingCarrierSchema,
  UpdateShippingConfigInput,
} from '../validators/shipping-config.validator';

/**
 * Maps a Prisma `ShippingCarrier` row to the wire shape exposed by the API.
 * Centralised so all four shipping routes serialize identically — drift here
 * (e.g. a field added on the schema but not in one of the route handlers)
 * would silently produce inconsistent payloads across endpoints.
 */
export function toCarrierResponse(c: ShippingCarrier): z.infer<typeof ShippingCarrierSchema> {
  return {
    id: c.id,
    platform: c.platform,
    externalId: c.externalId,
    code: c.code,
    displayName: c.displayName,
    supportsBaremDestek: c.supportsBaremDestek,
    maxBaremDesi: c.maxBaremDesi,
    sortOrder: c.sortOrder,
  };
}

export async function getShippingConfig(
  orgId: string,
  storeId: string,
  tx: Prisma.TransactionClient,
): Promise<{
  shippingTariffSource: Store['shippingTariffSource'];
  defaultShippingCarrier: ShippingCarrier | null;
}> {
  const store = await tx.store.findFirst({
    where: { id: storeId, organizationId: orgId },
    include: { defaultShippingCarrier: true },
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
): Promise<Store & { defaultShippingCarrier: ShippingCarrier | null }> {
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
    return await tx.store.update({
      where: { id: storeId },
      data: {
        shippingTariffSource: input.shippingTariffSource,
        defaultShippingCarrierId: input.defaultShippingCarrierId,
      },
      include: { defaultShippingCarrier: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }
}

export async function listShippingCarriers(
  filters: { platform?: Platform },
  tx: Prisma.TransactionClient,
): Promise<ShippingCarrier[]> {
  return tx.shippingCarrier.findMany({
    where: { active: true, ...(filters.platform ? { platform: filters.platform } : {}) },
    orderBy: { sortOrder: 'asc' },
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
 * Returns the desi-bazlı (NORMAL lane) tariff rows plus the Barem
 * desteği tier table for a single carrier. The tariff data itself is
 * platform-wide reference (not tenant-scoped), but membership is
 * still required to keep the endpoint behind the same authz boundary
 * as the rest of `/v1/organizations/{orgId}/...`.
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
  carrier: ShippingCarrier;
  desiTariffs: Array<{ desi: number; priceNet: Prisma.Decimal }>;
  baremTariffs: Array<{
    minOrderAmount: Prisma.Decimal;
    maxOrderAmount: Prisma.Decimal;
    priceNet: Prisma.Decimal;
  }>;
}> {
  const carrier = await tx.shippingCarrier.findFirst({
    where: { id: carrierId, active: true },
  });
  if (!carrier) throw new NotFoundError('ShippingCarrier', carrierId);

  const [desiTariffs, baremTariffs] = await Promise.all([
    tx.shippingDesiTariff.findMany({
      where: { carrierId },
      orderBy: { desi: 'asc' },
      select: { desi: true, priceNet: true },
    }),
    tx.shippingBaremTariff.findMany({
      where: { carrierId },
      orderBy: { minOrderAmount: 'asc' },
      select: { minOrderAmount: true, maxOrderAmount: true, priceNet: true },
    }),
  ]);

  return { carrier, desiTariffs, baremTariffs };
}
