/**
 * Profit-settings service — per-store profit-formula toggles.
 *
 * Tenant isolation: every store lookup includes `organizationId` in the WHERE clause,
 * so a member of org A cannot reach a store owned by org B. Missing store → NotFoundError
 * (404), never a cross-tenant existence disclosure (mirrors shipping-config.service).
 *
 * Storage: `Store.profitSettings` JSONB (extensible). GET always returns the RESOLVED
 * shape (defaults applied via @pazarsync/utils resolveProfitSettings). PATCH shallow-merges
 * only the keys provided, preserving any other stored keys — mirrors user-profile preferences.
 *
 * SNAPSHOT-AT-CREATE: this is the LIVE store setting; it is snapshotted onto each order at
 * order-create time, so a change here only affects orders created afterwards (the profit
 * engine reads the per-order snapshot, never this live value, for existing orders).
 */

import { mapPrismaError } from '@pazarsync/sync-core';
import { resolveProfitSettings, type ResolvedProfitSettings } from '@pazarsync/utils';

import type { Prisma } from '@pazarsync/db';

import { NotFoundError } from '../lib/errors';
import type { UpdateProfitSettingsInput } from '../validators/profit-settings.validator';

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function getProfitSettings(
  orgId: string,
  storeId: string,
  tx: Prisma.TransactionClient,
): Promise<ResolvedProfitSettings> {
  const store = await tx.store.findFirst({
    where: { id: storeId, organizationId: orgId },
    select: { profitSettings: true },
  });
  if (!store) throw new NotFoundError('Store', storeId);
  return resolveProfitSettings(store.profitSettings);
}

export async function updateProfitSettings(
  orgId: string,
  storeId: string,
  input: UpdateProfitSettingsInput,
  tx: Prisma.TransactionClient,
): Promise<ResolvedProfitSettings> {
  const store = await tx.store.findFirst({
    where: { id: storeId, organizationId: orgId },
    select: { profitSettings: true },
  });
  if (!store) throw new NotFoundError('Store', storeId);

  // Shallow-merge: only keys present in the patch override; omitted keys are preserved
  // (PATCH semantics). Unknown stored keys are kept too (forward-compatible container).
  const existing = isJsonObject(store.profitSettings) ? store.profitSettings : {};
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const merged: Prisma.InputJsonObject = { ...existing, ...patch };

  try {
    await tx.store.update({ where: { id: storeId }, data: { profitSettings: merged } });
  } catch (err) {
    mapPrismaError(err);
  }
  return resolveProfitSettings(merged);
}
