// Per-variant cost aggregate: the plain TL sum of the active (non-archived) cost
// profiles linked to each variant, read in one raw-SQL query. Every surface that
// shows a variant's current cost (e.g. the products list cost cell) reads it.
//
// Tenant scope: the variant must belong to the caller's organization AND store;
// the link and the profile must belong to the variant's organization, so a link
// to another organization's profile is never summed. The profile's store is NOT
// filtered: the cost rule (loadSellerInputsAt) is organization-scoped and the
// attach guard already refuses a cross-store attach.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';

import type { CostStatus, VariantCostAggregate } from '../validators/product.validator';

interface CostAggregateRow {
  variant_id: string;
  current_cost_try: unknown; // Decimal from PG, coerced below
  profile_count: bigint; // Prisma $queryRaw returns bigint for COUNT
}

function deriveCostStatus(profileCount: number): CostStatus {
  return profileCount === 0 ? 'NO_PROFILES' : 'OK';
}

/**
 * Cost aggregate per variant id, keyed by variant id. A variant outside the
 * (organizationId, storeId) scope is absent from the map. Status is OK when the
 * variant has at least one active profile, NO_PROFILES otherwise (then
 * `currentCostTry` is null).
 */
export async function fetchCostAggregates(args: {
  organizationId: string;
  storeId: string;
  variantIds: readonly string[];
}): Promise<Map<string, VariantCostAggregate>> {
  const { organizationId, storeId, variantIds } = args;
  if (variantIds.length === 0) return new Map();

  // The organization predicates sit in the ON clauses, not in WHERE, so a variant
  // with no matching link or profile still yields a row (count 0). Cast to uuid[]
  // so Postgres can match against the typed column.
  const rows = await prisma.$queryRaw<CostAggregateRow[]>`
    SELECT
      pv.id                                             AS variant_id,
      COALESCE(SUM(cp.amount_gross), 0)::DECIMAL(12,2)  AS current_cost_try,
      COUNT(cp.id)                                      AS profile_count
    FROM product_variants pv
    LEFT JOIN product_variant_cost_profiles pvcp
      ON pvcp.product_variant_id = pv.id
      AND pvcp.organization_id = pv.organization_id
    LEFT JOIN cost_profiles cp
      ON cp.id = pvcp.profile_id
      AND cp.organization_id = pv.organization_id
      AND cp.archived_at IS NULL
    WHERE pv.id = ANY(${[...variantIds]}::uuid[])
      AND pv.organization_id = ${organizationId}::uuid
      AND pv.store_id = ${storeId}::uuid
    GROUP BY pv.id
  `;

  const result = new Map<string, VariantCostAggregate>();
  for (const row of rows) {
    const profileCount = Number(row.profile_count);
    const costStatus = deriveCostStatus(profileCount);
    const rawCost = row.current_cost_try;
    const costDecimal =
      rawCost !== null && rawCost !== undefined ? new Decimal(String(rawCost)) : new Decimal(0);
    result.set(row.variant_id, {
      currentCostTry: profileCount > 0 ? costDecimal.toFixed(2) : null,
      profileCount,
      costStatus,
    });
  }
  return result;
}
