// Read + delete + selections service for the saved Plus Commission Tariffs feature.
//
// list   → one row per saved Plus tariff with aggregates (product / opted-in
//          counts, validity, exported flag).
// detail → the tariff with per-item current-vs-Plus profit COMPUTED on read by
//          `computePlusItem`, reusing the product-pricing assembly.
// delete → hard delete (cascades to items via the schema FK).
// updateSelections → bulk boolean opt-in + optional custom price.
//
// Every query is scoped by organizationId + storeId (tenant isolation). Money is
// serialized to GROSS decimal strings; the frontend renders only.

import { Decimal } from 'decimal.js';

import { Prisma, prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError } from '../lib/errors';
import { resolveValidity, tariffBoundInstantOrNull } from '../lib/tariff-period';
import {
  computePlusItem,
  type ComputedPlusItem,
  type PlusItemInputs,
} from './plus-commission-tariff-compute.service';
import {
  createRequestFailureLog,
  loadScreenScenarioBases,
  screenScenarioBaseFor,
} from './scenario-screen-commons';
import type {
  PlusTariffDetail,
  PlusTariffDetailItem,
  PlusTariffListItem,
  PlusTariffPeriod,
  PlusTariffSelection,
} from '../validators/plus-commission-tariff.validator';

// ─── List ───────────────────────────────────────────────────────────────────

/**
 * Lists every saved Plus tariff for a store with the aggregates the master list
 * shows: product count, opted-in count, overall validity, exported flag. Counts are
 * derived in memory from the periods + items (a store has a handful of uploads).
 *
 * A multi-period tariff carries one item per (product × period), so a raw item
 * count would multiply by the period count — `productCount` / `selectedCount` are
 * therefore de-duplicated by barcode to reflect UNIQUE products. Overall validity
 * spans the earliest period start to the latest period end (the week window).
 */
export async function listPlusTariffs(
  orgId: string,
  storeId: string,
): Promise<PlusTariffListItem[]> {
  let tariffs;
  try {
    tariffs = await prisma.plusCommissionTariff.findMany({
      where: { organizationId: orgId, storeId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        exportedAt: true,
        updatedAt: true,
        periods: {
          select: {
            startsAt: true,
            endsAt: true,
            items: { select: { barcode: true, plusSelected: true, customPrice: true } },
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  const now = new Date();
  return tariffs.map((tariff): PlusTariffListItem => {
    const productBarcodes = new Set<string>();
    const selectedBarcodes = new Set<string>();
    let minStart: Date | null = null;
    let maxEnd: Date | null = null;

    for (const period of tariff.periods) {
      for (const item of period.items) {
        productBarcodes.add(item.barcode);
        // A product counts as opted-in when it is joined to Plus or carries a
        // custom price (a what-if the seller kept) in ANY period.
        if (item.plusSelected || item.customPrice !== null) selectedBarcodes.add(item.barcode);
      }
      if (period.startsAt !== null && (minStart === null || period.startsAt < minStart)) {
        minStart = period.startsAt;
      }
      if (period.endsAt !== null && (maxEnd === null || period.endsAt > maxEnd)) {
        maxEnd = period.endsAt;
      }
    }

    return {
      id: tariff.id,
      name: tariff.name,
      productCount: productBarcodes.size,
      selectedCount: selectedBarcodes.size,
      exported: tariff.exportedAt !== null,
      // Period bounds are Istanbul wall-clock saved as UTC; convert them to real
      // instants before comparing against the true-instant `now`.
      validity: resolveValidity(
        tariffBoundInstantOrNull(minStart),
        tariffBoundInstantOrNull(maxEnd),
        now,
      ),
      weekStartsAt: minStart !== null ? minStart.toISOString() : null,
      weekEndsAt: maxEnd !== null ? maxEnd.toISOString() : null,
      updatedAt: tariff.updatedAt.toISOString(),
    };
  });
}

// ─── Detail ──────────────────────────────────────────────────────────────────

/**
 * Returns one Plus tariff with per-item current-vs-Plus profit computed on read.
 * Throws `NotFoundError` when the tariff does not belong to this store. Periods are
 * ordered by `sortOrder`; within each, items follow the Excel row order
 * (`sortOrder`, barcode tie-break) so every sub-period tab lists products
 * identically. The scenario bases of every matched variant are loaded ONCE for the
 * whole tariff, then each item is computed by the scenario engine with the chosen
 * commission as an override; a slim org + store scoped query supplies the display
 * image only. Per decision 9 a store-wide load failure or a per-item engine throw
 * leaves that profit empty (logged once) rather than failing the request.
 */
export async function getPlusTariffDetail(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<PlusTariffDetail> {
  let tariff;
  try {
    tariff = await prisma.plusCommissionTariff.findFirst({
      where: { id: tariffId, organizationId: orgId, storeId },
      select: {
        id: true,
        name: true,
        exportedAt: true,
        periods: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            dateRangeLabel: true,
            dayCount: true,
            startsAt: true,
            endsAt: true,
            items: {
              // Excel row order (`sortOrder`, set at import), barcode breaking ties —
              // the detail lists products exactly as in the uploaded file and
              // identically across sub-period tabs (same product → same sortOrder). id
              // makes the order total, so the export (same orderBy) resolves a
              // repeated barcode the same way.
              orderBy: [{ sortOrder: 'asc' }, { barcode: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                productVariantId: true,
                barcode: true,
                stockCode: true,
                productTitle: true,
                category: true,
                brand: true,
                currentPrice: true,
                commissionBasePrice: true,
                currentCommissionPct: true,
                plusPriceUpperLimit: true,
                plusCommissionPct: true,
                plusSelected: true,
                customPrice: true,
              },
            },
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (tariff === null) {
    throw new NotFoundError('PlusCommissionTariff', tariffId);
  }

  // ─── Collect matched variant ids across every period ──────────────────────
  const variantIds: string[] = [];
  for (const period of tariff.periods) {
    for (const item of period.items) {
      if (item.productVariantId !== null) variantIds.push(item.productVariantId);
    }
  }

  // ─── Display image per matched variant (org + store scoped) ───────────────
  // The only variant read the detail still needs; the profit inputs come from the
  // scenario loader below. First catalog image, null when none attached.
  const imageMap = new Map<string, string | null>();
  if (variantIds.length > 0) {
    let variants;
    try {
      variants = await prisma.productVariant.findMany({
        where: { id: { in: variantIds }, organizationId: orgId, storeId },
        select: { id: true, product: { select: { imageUrls: true } } },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    for (const variant of variants) {
      imageMap.set(variant.id, variant.product.imageUrls[0] ?? null);
    }
  }

  // ─── One scenario-base load for the whole tariff; scenario date = now ─────
  const now = new Date();
  const bases = await loadScreenScenarioBases({
    organizationId: orgId,
    storeId,
    scenarioDate: now,
    variantIds,
    surface: 'plus-commission-tariff',
  });

  // A per-item engine throw degrades only that item; collect and log once (decision 9).
  const failureLog = createRequestFailureLog({
    surface: 'plus-commission-tariff',
    organizationId: orgId,
  });

  const periods = tariff.periods.map((period): PlusTariffPeriod => {
    const items = period.items.map((item): PlusTariffDetailItem => {
      const base = screenScenarioBaseFor(bases, item.productVariantId);

      // The committed custom price is intentionally NOT passed to the compute: the
      // Plus offer scenario is always the ceiling (see plus-commission-tariff-compute
      // .service). The custom price is still echoed on the wire (below), exported, and
      // priced free-form by the estimate endpoint.
      const inputs: PlusItemInputs = {
        currentPrice: new Decimal(item.currentPrice.toString()),
        commissionBasePrice: new Decimal(item.commissionBasePrice.toString()),
        currentCommissionPct: new Decimal(item.currentCommissionPct.toString()),
        plusPriceUpperLimit: new Decimal(item.plusPriceUpperLimit.toString()),
        plusCommissionPct: new Decimal(item.plusCommissionPct.toString()),
      };
      let computed: ComputedPlusItem;
      try {
        computed = computePlusItem({ inputs, base });
      } catch (err) {
        failureLog.record(err);
        computed = computePlusItem({ inputs, base: { kind: 'degraded' } });
      }

      return {
        id: item.id,
        barcode: item.barcode,
        stockCode: item.stockCode,
        productTitle: item.productTitle,
        imageUrl:
          item.productVariantId !== null ? (imageMap.get(item.productVariantId) ?? null) : null,
        category: item.category,
        brand: item.brand,
        currentPrice: item.currentPrice.toFixed(2),
        commissionBasePrice: item.commissionBasePrice.toFixed(2),
        currentCommissionPct: item.currentCommissionPct.toFixed(4),
        currentNetProfit: computed.current.netProfit,
        currentMarginPct: computed.current.marginPct,
        plusPriceUpperLimit: item.plusPriceUpperLimit.toFixed(2),
        plus: computed.plus,
        plusIsBetter: computed.plusIsBetter,
        calculable: computed.calculable,
        reason: computed.reason,
        selected: item.plusSelected,
        customPrice: item.customPrice !== null ? item.customPrice.toFixed(2) : null,
      };
    });

    return {
      id: period.id,
      dateRangeLabel: period.dateRangeLabel,
      dayCount: period.dayCount,
      // Period bounds are Istanbul wall-clock saved as UTC; convert them to real
      // instants before comparing against the true-instant `now`.
      validity: resolveValidity(
        tariffBoundInstantOrNull(period.startsAt),
        tariffBoundInstantOrNull(period.endsAt),
        now,
      ),
      items,
    };
  });

  failureLog.flush();

  return { id: tariff.id, name: tariff.name, exported: tariff.exportedAt !== null, periods };
}

// ─── Delete ────────────────────────────────────────────────────────────────

/**
 * Hard-deletes a Plus tariff (items cascade via FK). Throws `NotFoundError` when
 * it does not belong to this store, so a cross-tenant id is indistinguishable
 * from a missing one.
 */
export async function deletePlusTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<void> {
  const existing = await prisma.plusCommissionTariff.findFirst({
    where: { id: tariffId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (existing === null) {
    throw new NotFoundError('PlusCommissionTariff', tariffId);
  }

  try {
    await prisma.plusCommissionTariff.delete({ where: { id: tariffId } });
  } catch (err) {
    mapPrismaError(err);
  }
}

// ─── Save selections ─────────────────────────────────────────────────────────

/**
 * Persists the seller's Plus opt-in + optional custom price for the given items
 * in ONE bulk UPDATE (a VALUES join). Throws `NotFoundError` when the tariff is
 * not in this store. Each row is gated on `(organization_id, store_id, period ∈
 * tariff)`, so an itemId from another tariff/store is silently skipped — the
 * returned `updated` count reflects only rows that actually matched.
 */
export async function updatePlusSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
  selections: ReadonlyArray<PlusTariffSelection>,
): Promise<{ updated: number }> {
  const tariff = await prisma.plusCommissionTariff.findFirst({
    where: { id: tariffId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (tariff === null) {
    throw new NotFoundError('PlusCommissionTariff', tariffId);
  }
  if (selections.length === 0) return { updated: 0 };

  const rows = selections.map(
    (s) => Prisma.sql`(${s.itemId}::uuid, ${s.selected}::boolean, ${s.customPrice}::numeric)`,
  );

  try {
    const updated = await prisma.$executeRaw`
      UPDATE plus_commission_tariff_items AS i
      SET plus_selected = v.selected, custom_price = v.custom_price, updated_at = now()
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, selected, custom_price)
      WHERE i.id = v.id
        AND i.organization_id = ${orgId}::uuid
        AND i.store_id = ${storeId}::uuid
        AND i.period_id IN (
          SELECT p.id FROM plus_commission_tariff_periods p WHERE p.tariff_id = ${tariffId}::uuid
        )
    `;
    return { updated };
  } catch (err) {
    mapPrismaError(err);
  }
}
