// Read + delete + selections + commission-source service for the Advantage
// Product Labels feature.
//
// list   → one row per saved advantage tariff (product / selected counts, exported).
// detail → the tariff with per-item, per-tier profit COMPUTED on read. The reduced
//          commission is READ from the store's active-period Commission Tariff (or
//          the pinned override) via a barcode → bands lookup, with a category-rate
//          fallback. The resolved source (tariff + period) is surfaced so the seller
//          can confirm the periods align.
// delete → hard delete (cascades to items via the schema FK).
// updateSelections      → bulk tier choice + optional custom price.
// updateCommissionSource → pin (or clear → category commission) which commission tariff supplies rates.
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
import { resolveCommissionRate } from './commission-rate-resolver';
import { parseStoredBands, type StoredBand } from './commission-tariff.types';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import {
  computeAdvantageItemTiers,
  type ComputedAdvantageItem,
  type ItemCommissionInputs,
} from './advantage-tariff-compute.service';
import {
  NO_SHIPPING,
  type TariffAssemblyContext,
  type TariffVariant,
} from './tariff-compute-commons';
import { parseStarTiers } from './advantage-tariff.types';
import type { VariantCostAggregate } from '../validators/product.validator';
import type {
  AdvantageCommissionSource,
  AdvantageTariffDetail,
  AdvantageTariffDetailItem,
  AdvantageTariffListItem,
  AdvantageTariffSelection,
  StarTierKey,
} from '../validators/advantage-tariff.validator';

// Narrows the free-text stored `selected_tier` to the tier enum (null otherwise).
function toTierKey(value: string | null): StarTierKey | null {
  return value === 'tier1' || value === 'tier2' || value === 'tier3' ? value : null;
}

// ─── Commission source resolution (the cross-vertical read) ──────────────────

interface CommissionSourceResolution {
  readonly tariffId: string;
  readonly tariffName: string;
  readonly periodLabel: string;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /** barcode → its commission bands, from the resolved period. */
  readonly bandsByBarcode: ReadonlyMap<string, StoredBand[]>;
}

/**
 * Resolves which Commission Tariff period supplies the reduced rates. When a tariff
 * is pinned, uses that tariff's sub-period active now, else the nearest-upcoming, else
 * its last (past) period. Returns null when nothing is pinned (the seller chose the
 * category commission at upload) or the pinned tariff has no usable period. This is the
 * one place the advantage vertical reads another vertical's data — always store-scoped.
 */
export async function resolveCommissionSource(
  orgId: string,
  storeId: string,
  overrideTariffId: string | null,
  now: Date,
): Promise<CommissionSourceResolution | null> {
  const periodSelect = {
    id: true,
    tariffId: true,
    dateRangeLabel: true,
    startsAt: true,
    endsAt: true,
    tariff: { select: { name: true } },
  } as const;

  let period:
    | {
        id: string;
        tariffId: string;
        dateRangeLabel: string;
        startsAt: Date | null;
        endsAt: Date | null;
        tariff: { name: string };
      }
    | null
    | undefined;

  // No pinned tariff → category-only (the seller chose "kategori komisyonu" at
  // upload, or this is a pre-picker record). There is no silent auto-resolution:
  // the Advantage upload makes the commission tariff choice explicit.
  if (overrideTariffId === null) return null;

  try {
    const periods = await prisma.commissionTariffPeriod.findMany({
      where: { organizationId: orgId, storeId, tariffId: overrideTariffId },
      orderBy: { sortOrder: 'asc' },
      select: periodSelect,
    });
    // Within the pinned week, use the sub-period (3-Gün / 4-Gün) active NOW; else,
    // when the whole week is still upcoming (preparing ahead), the one that starts
    // SOONEST; else the last (a fully-past week).
    const nowMs = now.getTime();
    const active = periods.find((p) => resolveValidity(p.startsAt, p.endsAt, now) === 'active');
    const upcoming = periods
      .flatMap((p) =>
        p.startsAt !== null && p.startsAt.getTime() > nowMs ? [{ p, t: p.startsAt.getTime() }] : [],
      )
      .sort((a, b) => a.t - b.t)[0]?.p;
    period = active ?? upcoming ?? periods.at(-1) ?? null;
  } catch (err) {
    mapPrismaError(err);
  }

  if (period === null || period === undefined) return null;

  let items;
  try {
    items = await prisma.commissionTariffItem.findMany({
      where: { organizationId: orgId, storeId, periodId: period.id },
      select: { barcode: true, bands: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  const bandsByBarcode = new Map<string, StoredBand[]>();
  for (const item of items) bandsByBarcode.set(item.barcode, parseStoredBands(item.bands));

  return {
    tariffId: period.tariffId,
    tariffName: period.tariff.name,
    periodLabel: period.dateRangeLabel,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    bandsByBarcode,
  };
}

// ─── List ───────────────────────────────────────────────────────────────────

/** Lists every saved advantage tariff for a store with product/selected counts. */
export async function listAdvantageTariffs(
  orgId: string,
  storeId: string,
): Promise<AdvantageTariffListItem[]> {
  let tariffs;
  try {
    tariffs = await prisma.advantageTariff.findMany({
      where: { organizationId: orgId, storeId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        exportedAt: true,
        updatedAt: true,
        items: { select: { selectedTier: true, customPrice: true } },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return tariffs.map((tariff): AdvantageTariffListItem => {
    let selectedCount = 0;
    for (const item of tariff.items) {
      // A row counts as selected when it has a tier OR a custom price. A confirmed
      // custom price is persisted with selected_tier = NULL (custom_price only), so
      // keying on selectedTier alone undercounts custom-only rows — the same root
      // cause as the export skip (resolveAdvantageExportPrice).
      if (item.selectedTier !== null || item.customPrice !== null) selectedCount += 1;
    }
    return {
      id: tariff.id,
      name: tariff.name,
      productCount: tariff.items.length,
      selectedCount,
      exported: tariff.exportedAt !== null,
      updatedAt: tariff.updatedAt.toISOString(),
    };
  });
}

// ─── Detail ──────────────────────────────────────────────────────────────────

/**
 * Returns one advantage tariff with per-item, per-tier profit computed on read.
 * Throws `NotFoundError` when it does not belong to this store. Resolves the
 * commission source once, batch-loads variants + cost + shipping + category
 * rates, then computes each item's tiers by reusing the product-pricing assembly.
 */
export async function getAdvantageTariffDetail(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  tariffId: string,
): Promise<AdvantageTariffDetail> {
  let tariff;
  try {
    tariff = await prisma.advantageTariff.findFirst({
      where: { id: tariffId, organizationId: orgId, storeId },
      select: {
        id: true,
        name: true,
        exportedAt: true,
        commissionSourceTariffId: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            productVariantId: true,
            barcode: true,
            stockCode: true,
            productTitle: true,
            category: true,
            brand: true,
            size: true,
            stock: true,
            currentPrice: true,
            customerPrice: true,
            hasCommissionTariff: true,
            starTiers: true,
            selectedTier: true,
            customPrice: true,
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (tariff === null) {
    throw new NotFoundError('AdvantageTariff', tariffId);
  }

  const now = new Date();

  // ─── Batch-resolve matched variants + cost + shipping + image once ────────
  const variantIds = tariff.items
    .map((i) => i.productVariantId)
    .filter((id): id is string => id !== null);

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

  // ─── Resolve the commission source + a category-rate fallback cache ───────
  const source = await resolveCommissionSource(
    orgId,
    storeId,
    tariff.commissionSourceTariffId,
    now,
  );

  // Resolve the category rate once per distinct (categoryId, brandId) among the
  // matched variants — the fallback commission for products with no tariff band.
  const categoryRateByKey = new Map<string, Decimal | null>();
  const distinctCatKeys = new Map<string, { categoryId: bigint; brandId: bigint | null }>();
  for (const variant of variantMap.values()) {
    const { categoryId, brandId } = variant.product;
    if (categoryId === null) continue;
    distinctCatKeys.set(`${categoryId}:${brandId ?? 'null'}`, { categoryId, brandId });
  }
  await Promise.all(
    [...distinctCatKeys].map(async ([key, { categoryId, brandId }]) => {
      const resolved = await resolveCommissionRate({
        platform: store.platform,
        categoryId,
        brandId,
        sellerSegment: null,
      });
      categoryRateByKey.set(key, resolved?.rate ?? null);
    }),
  );

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));
  const ctx: TariffAssemblyContext = { platform: store.platform, feeDefs };

  let hasUnmatchedCommissionProducts = false;

  const items = tariff.items.map((item): AdvantageTariffDetailItem => {
    const variant =
      item.productVariantId !== null ? variantMap.get(item.productVariantId) : undefined;
    const cost = item.productVariantId !== null ? costMap.get(item.productVariantId) : undefined;
    const shipping =
      item.productVariantId !== null
        ? (shippingMap.get(item.productVariantId) ?? NO_SHIPPING)
        : NO_SHIPPING;

    const bands = source?.bandsByBarcode.get(item.barcode) ?? null;
    if (item.hasCommissionTariff && bands === null) hasUnmatchedCommissionProducts = true;

    const categoryRate =
      variant && variant.product.categoryId !== null
        ? (categoryRateByKey.get(
            `${variant.product.categoryId}:${variant.product.brandId ?? 'null'}`,
          ) ?? null)
        : null;

    const commission: ItemCommissionInputs = { bands, categoryRate };
    // The "current" baseline profit is computed on the price the buyer actually pays
    // (customerPrice = "Müşterinin Gördüğü Fiyat"), NOT the raw Trendyol list price
    // (currentPrice = TSF). Commission and settlement are levied on the customer-paid
    // price, and Trendyol's own badge eligibility ("geçerli aralık") is checked against
    // it too. customerPrice falls back to currentPrice at import when no discount is
    // active, so products without a discount are unaffected. See profit-formula.md §2.1.
    const computed: ComputedAdvantageItem = computeAdvantageItemTiers(
      ctx,
      parseStarTiers(item.starTiers),
      new Decimal(item.customerPrice.toString()),
      variant ?? null,
      cost,
      shipping,
      commission,
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
      size: item.size,
      stock: item.stock,
      currentPrice: item.currentPrice.toFixed(2),
      customerPrice: item.customerPrice.toFixed(2),
      hasCommissionTariff: item.hasCommissionTariff,
      calculable: computed.calculable,
      reason: computed.reason,
      current: computed.current,
      tiers: [...computed.tiers],
      bestTierKey: computed.bestTierKey,
      selectedTier: toTierKey(item.selectedTier),
      customPrice: item.customPrice !== null ? item.customPrice.toFixed(2) : null,
    };
  });

  const commissionSource: AdvantageCommissionSource | null =
    source === null
      ? null
      : {
          tariffId: source.tariffId,
          tariffName: source.tariffName,
          periodLabel: source.periodLabel,
          startsAt: source.startsAt?.toISOString() ?? null,
          endsAt: source.endsAt?.toISOString() ?? null,
        };

  return {
    id: tariff.id,
    name: tariff.name,
    exported: tariff.exportedAt !== null,
    // Pinned = a commission tariff supplied the bands; category = none picked (or a
    // pinned tariff was deleted / had no resolvable period → category fallback).
    commissionSourceMode: source !== null ? 'pinned' : 'category',
    commissionSource,
    hasUnmatchedCommissionProducts,
    items,
  };
}

// ─── Delete ────────────────────────────────────────────────────────────────

/** Hard-deletes an advantage tariff (items cascade). 404 when not in this store. */
export async function deleteAdvantageTariff(
  orgId: string,
  storeId: string,
  tariffId: string,
): Promise<void> {
  const existing = await prisma.advantageTariff.findFirst({
    where: { id: tariffId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (existing === null) {
    throw new NotFoundError('AdvantageTariff', tariffId);
  }

  try {
    await prisma.advantageTariff.delete({ where: { id: tariffId } });
  } catch (err) {
    mapPrismaError(err);
  }
}

// ─── Save selections ─────────────────────────────────────────────────────────

/**
 * Persists the seller's tier choice + optional custom price in ONE bulk UPDATE.
 * 404 when the tariff is not in this store. Each row is gated on
 * `(organization_id, store_id, tariff)`, so a foreign itemId is silently skipped.
 */
export async function updateAdvantageSelections(
  orgId: string,
  storeId: string,
  tariffId: string,
  selections: ReadonlyArray<AdvantageTariffSelection>,
): Promise<{ updated: number }> {
  const tariff = await prisma.advantageTariff.findFirst({
    where: { id: tariffId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (tariff === null) {
    throw new NotFoundError('AdvantageTariff', tariffId);
  }
  if (selections.length === 0) return { updated: 0 };

  const rows = selections.map(
    (s) => Prisma.sql`(${s.itemId}::uuid, ${s.tier}::text, ${s.customPrice}::numeric)`,
  );

  try {
    const updated = await prisma.$executeRaw`
      UPDATE advantage_tariff_items AS i
      SET selected_tier = v.tier, custom_price = v.custom_price, updated_at = now()
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, tier, custom_price)
      WHERE i.id = v.id
        AND i.organization_id = ${orgId}::uuid
        AND i.store_id = ${storeId}::uuid
        AND i.tariff_id = ${tariffId}::uuid
    `;
    return { updated };
  } catch (err) {
    mapPrismaError(err);
  }
}

// ─── Commission source switch ───────────────────────────────────────────────

/**
 * Pins (or clears → category commission) which Commission Tariff supplies the reduced rates.
 * 404 when the advantage tariff — or a non-null commission source — is not in this
 * store, so a cross-tenant id is indistinguishable from a missing one.
 */
export async function updateAdvantageCommissionSource(
  orgId: string,
  storeId: string,
  tariffId: string,
  commissionSourceTariffId: string | null,
): Promise<{ commissionSourceTariffId: string | null }> {
  const tariff = await prisma.advantageTariff.findFirst({
    where: { id: tariffId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (tariff === null) {
    throw new NotFoundError('AdvantageTariff', tariffId);
  }

  if (commissionSourceTariffId !== null) {
    const source = await prisma.commissionTariff.findFirst({
      where: { id: commissionSourceTariffId, organizationId: orgId, storeId },
      select: { id: true },
    });
    if (source === null) {
      throw new NotFoundError('CommissionTariff', commissionSourceTariffId);
    }
  }

  try {
    await prisma.advantageTariff.update({
      where: { id: tariffId },
      data: { commissionSourceTariffId },
    });
    return { commissionSourceTariffId };
  } catch (err) {
    mapPrismaError(err);
  }
}
