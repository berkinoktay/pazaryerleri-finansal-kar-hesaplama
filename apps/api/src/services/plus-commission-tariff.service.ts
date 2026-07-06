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
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import { resolveValidity } from '../lib/tariff-period';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import {
  computePlusItem,
  type ComputedPlusItem,
  type PlusItemInputs,
} from './plus-commission-tariff-compute.service';
import {
  NO_SHIPPING,
  type TariffAssemblyContext,
  type TariffVariant,
} from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';
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
      validity: resolveValidity(minStart, maxEnd, now),
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
 * identically. Matched items are joined to their ProductVariant; cost + shipping
 * are batch-resolved ONCE for the whole tariff, fee definitions once, then each
 * item is computed by reusing the product-pricing assembly.
 */
export async function getPlusTariffDetail(
  orgId: string,
  storeId: string,
  store: PrismaStore,
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
              // identically across sub-period tabs (same product → same sortOrder).
              orderBy: [{ sortOrder: 'asc' }, { barcode: 'asc' }],
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

  // ─── Batch-resolve variants + cost + shipping + image once ────────────────
  const variantMap = new Map<string, TariffVariant>();
  const imageMap = new Map<string, string | null>();
  let costMap = new Map<string, VariantCostAggregate>();
  let shippingMap = new Map<string, EstimateOutcome>();

  if (variantIds.length > 0) {
    let variants;
    try {
      variants = await prisma.productVariant.findMany({
        where: { id: { in: variantIds }, organizationId: orgId, storeId },
        select: {
          id: true,
          stockCode: true,
          barcode: true,
          salePrice: true,
          vatRate: true,
          isDigital: true,
          product: {
            select: {
              title: true,
              categoryId: true,
              brandId: true,
              images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
            },
          },
        },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    for (const variant of variants) {
      variantMap.set(variant.id, variant);
      imageMap.set(variant.id, variant.product.images[0]?.url ?? null);
    }

    [costMap, shippingMap] = await Promise.all([
      fetchCostAggregates(orgId, variantIds),
      batchResolveShipping(orgId, storeId, variantIds),
    ]);
  }

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));
  const ctx: TariffAssemblyContext = { platform: store.platform, feeDefs };
  const now = new Date();

  const periods = tariff.periods.map((period): PlusTariffPeriod => {
    const items = period.items.map((item): PlusTariffDetailItem => {
      const variant =
        item.productVariantId !== null ? variantMap.get(item.productVariantId) : undefined;
      const cost = item.productVariantId !== null ? costMap.get(item.productVariantId) : undefined;
      const shipping =
        item.productVariantId !== null
          ? (shippingMap.get(item.productVariantId) ?? NO_SHIPPING)
          : NO_SHIPPING;

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
      const computed: ComputedPlusItem = computePlusItem(
        ctx,
        inputs,
        variant ?? null,
        cost,
        shipping,
      );

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
      validity: resolveValidity(period.startsAt, period.endsAt, now),
      items,
    };
  });

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
