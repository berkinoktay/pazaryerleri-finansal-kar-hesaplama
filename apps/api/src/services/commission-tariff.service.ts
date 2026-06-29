// Read + delete service for the saved Commission Tariffs feature.
//
// list   → one row per saved tariff with aggregates (product / selection counts,
//          overall validity, exported flag) for the master list.
// detail → the full tariff with per-band profit COMPUTED on read (never stored)
//          by `computeItemBands`, which reuses the product-pricing assembly.
// delete → hard delete (cascades to periods + items via the schema FK).
//
// Every query is scoped by organizationId + storeId (tenant isolation). All money
// is serialized to GROSS decimal strings; the frontend renders only.

import { Decimal } from 'decimal.js';

import { Prisma, prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import {
  computeItemBands,
  type ComputedItemBands,
  type TariffAssemblyContext,
  type TariffVariant,
} from './commission-tariff-compute.service';
import { parseStoredBands, resolveValidity } from './commission-tariff.types';
import type { VariantCostAggregate } from '../validators/product.validator';
import type {
  CommissionTariffDetail,
  CommissionTariffListItem,
  TariffDetailItem,
  TariffPeriod,
  TariffSelection,
} from '../validators/commission-tariff.validator';

// A variant the CTE/cost resolvers could not place degrades to not-calculable.
const NO_SHIPPING: EstimateOutcome = { ok: false, reason: 'STORE_NOT_FOUND' };

// ─── List ───────────────────────────────────────────────────────────────────

/**
 * Lists every saved tariff for a store with the aggregates the master list
 * shows. Counts and overall validity are derived in memory from the periods +
 * items (tariff count per store is small — a handful of uploads). Overall
 * validity spans the earliest period start to the latest period end.
 */
export async function listTariffs(
  orgId: string,
  storeId: string,
): Promise<CommissionTariffListItem[]> {
  let tariffs;
  try {
    tariffs = await prisma.commissionTariff.findMany({
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
            items: { select: { selectedBand: true } },
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  const now = new Date();
  return tariffs.map((tariff): CommissionTariffListItem => {
    let productCount = 0;
    let selectedCount = 0;
    let minStart: Date | null = null;
    let maxEnd: Date | null = null;

    for (const period of tariff.periods) {
      for (const item of period.items) {
        productCount += 1;
        if (item.selectedBand !== null) selectedCount += 1;
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
      productCount,
      selectedCount,
      exported: tariff.exportedAt !== null,
      validity: resolveValidity(minStart, maxEnd, now),
      updatedAt: tariff.updatedAt.toISOString(),
    };
  });
}

// ─── Detail ──────────────────────────────────────────────────────────────────

/**
 * Returns one tariff with per-band profit computed on read. Throws
 * `NotFoundError` when the tariff does not belong to this store (non-disclosure).
 * Matched items are joined to their ProductVariant; cost + shipping are
 * batch-resolved once, fee definitions once, then each item's bands are computed
 * by reusing the product-pricing assembly with the band's commission.
 */
export async function getTariffDetail(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  tariffId: string,
): Promise<CommissionTariffDetail> {
  let tariff;
  try {
    tariff = await prisma.commissionTariff.findFirst({
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
            startsAt: true,
            endsAt: true,
            items: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                productVariantId: true,
                barcode: true,
                stockCode: true,
                productTitle: true,
                category: true,
                brand: true,
                currentPrice: true,
                currentCommissionPct: true,
                bands: true,
                selectedBand: true,
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
    throw new NotFoundError('CommissionTariff', tariffId);
  }

  // ─── Collect matched variant ids across every period ──────────────────────
  const variantIds: string[] = [];
  for (const period of tariff.periods) {
    for (const item of period.items) {
      if (item.productVariantId !== null) variantIds.push(item.productVariantId);
    }
  }

  // ─── Batch-resolve variants + cost + shipping once for the whole tariff ───
  const variantMap = new Map<string, TariffVariant>();
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
          product: { select: { title: true, categoryId: true, brandId: true } },
        },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    for (const variant of variants) variantMap.set(variant.id, variant);

    [costMap, shippingMap] = await Promise.all([
      fetchCostAggregates(orgId, variantIds),
      batchResolveShipping(orgId, storeId, variantIds),
    ]);
  }

  // ─── Fee definitions once, then compute every item (pure) ─────────────────
  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));
  const ctx: TariffAssemblyContext = { platform: store.platform, feeDefs };

  const periods = tariff.periods.map((period): TariffPeriod => {
    const items = period.items.map((item): TariffDetailItem => {
      const variant =
        item.productVariantId !== null ? variantMap.get(item.productVariantId) : undefined;
      const cost = item.productVariantId !== null ? costMap.get(item.productVariantId) : undefined;
      const shipping =
        item.productVariantId !== null
          ? (shippingMap.get(item.productVariantId) ?? NO_SHIPPING)
          : NO_SHIPPING;

      const computed: ComputedItemBands = computeItemBands(
        ctx,
        parseStoredBands(item.bands),
        new Decimal(item.currentPrice.toString()),
        variant ?? null,
        cost,
        shipping,
      );

      return {
        id: item.id,
        barcode: item.barcode,
        stockCode: item.stockCode,
        productTitle: item.productTitle,
        category: item.category,
        brand: item.brand,
        currentPrice: item.currentPrice.toFixed(2),
        currentCommissionPct: item.currentCommissionPct.toFixed(4),
        calculable: computed.calculable,
        reason: computed.reason,
        bestBandKey: computed.bestBandKey,
        selectedBand: item.selectedBand,
        customPrice: item.customPrice !== null ? item.customPrice.toFixed(2) : null,
        bands: computed.bands.map((band) => ({
          key: band.key,
          lowerLimit: band.lowerLimit,
          upperLimit: band.upperLimit,
          price: band.price,
          commissionPct: band.commissionPct,
          netProfit: band.netProfit,
          marginPct: band.marginPct,
        })),
      };
    });

    return {
      id: period.id,
      dateRangeLabel: period.dateRangeLabel,
      validity: resolveValidity(period.startsAt, period.endsAt, new Date()),
      items,
    };
  });

  return { id: tariff.id, name: tariff.name, exported: tariff.exportedAt !== null, periods };
}

// ─── Delete ────────────────────────────────────────────────────────────────

/**
 * Hard-deletes a tariff (periods + items cascade via FK). Throws `NotFoundError`
 * when it does not belong to this store, so a cross-tenant id is indistinguishable
 * from a missing one.
 */
export async function deleteTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<void> {
  const existing = await prisma.commissionTariff.findFirst({
    where: { id: tariffId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (existing === null) {
    throw new NotFoundError('CommissionTariff', tariffId);
  }

  try {
    await prisma.commissionTariff.delete({ where: { id: tariffId } });
  } catch (err) {
    mapPrismaError(err);
  }
}

// ─── Save selections ─────────────────────────────────────────────────────────

/**
 * Persists the seller's band selection + custom price for the given items in ONE
 * bulk UPDATE (a VALUES join), so selecting across a large catalog stays a single
 * round-trip rather than N. Throws `NotFoundError` when the tariff is not in this
 * store. Each row is gated on `(organization_id, store_id, period ∈ tariff)`, so
 * an itemId from another tariff/store is silently skipped (not updated) — the
 * returned `updated` count reflects only rows that actually matched.
 */
export async function updateSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
  selections: ReadonlyArray<TariffSelection>,
): Promise<{ updated: number }> {
  const tariff = await prisma.commissionTariff.findFirst({
    where: { id: tariffId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (tariff === null) {
    throw new NotFoundError('CommissionTariff', tariffId);
  }
  if (selections.length === 0) return { updated: 0 };

  const rows = selections.map(
    (s) => Prisma.sql`(${s.itemId}::uuid, ${s.band}::text, ${s.customPrice}::numeric)`,
  );

  try {
    const updated = await prisma.$executeRaw`
      UPDATE commission_tariff_items AS i
      SET selected_band = v.band, custom_price = v.custom_price, updated_at = now()
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, band, custom_price)
      WHERE i.id = v.id
        AND i.organization_id = ${orgId}::uuid
        AND i.store_id = ${storeId}::uuid
        AND i.period_id IN (
          SELECT p.id FROM commission_tariff_periods p WHERE p.tariff_id = ${tariffId}::uuid
        )
    `;
    return { updated };
  } catch (err) {
    mapPrismaError(err);
  }
}
