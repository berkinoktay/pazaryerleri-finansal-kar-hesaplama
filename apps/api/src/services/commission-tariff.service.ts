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
import { ProfitRecomputeReason } from '@pazarsync/db/enums';
import { mapPrismaError } from '@pazarsync/sync-core';
import { enqueueProfitRecomputeForBarcodes, parseStoredTariffBands } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import { resolveValidity, tariffBoundInstantOrNull } from '../lib/tariff-period';
import { computeItemBands, type ComputedItemBands } from './commission-tariff-compute.service';
import {
  createRequestFailureLog,
  loadScreenScenarioBases,
  screenScenarioBaseFor,
} from './scenario-screen-commons';
import type {
  CommissionTariffDetail,
  CommissionTariffListItem,
  TariffDetailItem,
  TariffPeriod,
  TariffSelection,
} from '../validators/commission-tariff.validator';

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
 * Returns one tariff with per-band profit computed on read. Throws
 * `NotFoundError` when the tariff does not belong to this store (non-disclosure).
 * The scenario bases of every matched variant are loaded once for the whole tariff,
 * then each item's bands are computed by the scenario engine with the band's
 * commission as an override. A slim org + store scoped variant query supplies the
 * display image only. Per decision 9 a store-wide load failure or a per-item engine
 * throw leaves that profit empty (logged once) rather than failing the request.
 */
export async function getTariffDetail(
  orgId: string,
  storeId: string,
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
            dayCount: true,
            startsAt: true,
            endsAt: true,
            items: {
              // Excel row order (`sortOrder`, set at import) so the detail lists products
              // exactly as in the uploaded file — matching Trendyol's own screen — and
              // identically across sub-period tabs (same product → same sortOrder in every
              // period). Barcode breaks any tie (e.g. legacy rows imported before the
              // column existed, all defaulting to 0); id makes the order total, so the
              // export (same orderBy) resolves a repeated barcode the same way.
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

  // ─── Display image per matched variant (org + store scoped) ───────────────
  // First catalog image (barcode-matched, from our own catalog); the Trendyol tariff
  // file carries no images. Null when none attached. This is the only variant read the
  // detail still needs -- the profit inputs come from the scenario loader below.
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
    surface: 'commission-tariff',
  });

  // A per-item engine throw degrades only that item; collect and log once (decision 9).
  const failureLog = createRequestFailureLog({
    surface: 'commission-tariff',
    organizationId: orgId,
  });

  const periods = tariff.periods.map((period): TariffPeriod => {
    const items = period.items.map((item): TariffDetailItem => {
      const base = screenScenarioBaseFor(bases, item.productVariantId);
      const bandParams = {
        bands: parseStoredTariffBands(item.bands),
        currentPrice: new Decimal(item.currentPrice.toString()),
        commissionBasePrice:
          item.commissionBasePrice !== null
            ? new Decimal(item.commissionBasePrice.toString())
            : null,
        currentCommissionPct: new Decimal(item.currentCommissionPct.toString()),
      };
      let computed: ComputedItemBands;
      try {
        computed = computeItemBands({ ...bandParams, base });
      } catch (err) {
        failureLog.record(err);
        computed = computeItemBands({ ...bandParams, base: { kind: 'degraded' } });
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
        commissionBasePrice:
          item.commissionBasePrice !== null ? item.commissionBasePrice.toFixed(2) : null,
        currentCommissionPct: item.currentCommissionPct.toFixed(4),
        currentNetProfit: computed.current.netProfit,
        currentMarginPct: computed.current.marginPct,
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
 * Hard-deletes a tariff (periods + items cascade via FK) in one transaction. Throws
 * `NotFoundError` when it does not belong to this store, so a cross-tenant id is
 * indistinguishable from a missing one. Deleting a tariff is a backdated commission
 * input change for every order carrying one of its barcodes (their commission falls
 * back from the tariff bands to the product/category rate), so those orders are queued
 * for a profit recompute in the SAME transaction; the stale-statement sweep would not
 * catch them (their statements are stamped by the current engine).
 */
export async function deleteTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.commissionTariff.findFirst({
        where: { id: tariffId, organizationId: orgId, storeId },
        select: { id: true },
      });
      if (existing === null) {
        throw new NotFoundError('CommissionTariff', tariffId);
      }

      // Collect the tariff's distinct item barcodes BEFORE the delete cascades the
      // items away. A deleted variant still leaves its barcode on the item row.
      const items = await tx.commissionTariffItem.findMany({
        where: { organizationId: orgId, storeId, period: { tariffId } },
        select: { barcode: true },
        distinct: ['barcode'],
      });
      const barcodes = items.map((item) => item.barcode);

      await tx.commissionTariff.delete({ where: { id: tariffId } });

      await enqueueProfitRecomputeForBarcodes(tx, {
        organizationId: orgId,
        storeId,
        barcodes,
        reason: ProfitRecomputeReason.REFERENCE_CHANGED,
      });
    });
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
