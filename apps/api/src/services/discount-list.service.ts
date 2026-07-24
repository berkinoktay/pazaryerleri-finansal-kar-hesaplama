// Read / update / delete service for the İndirimler (Promosyon > İndirimler) feature.
//
// list      → one row per saved discount list (config fields, item + selected counts,
//             exported flag).
// detail    → the list with its items (sortOrder asc), each carrying the current +
//             discounted price SCENARIOS. Görev 8 ships the FIXED placeholder scenarios
//             (calculable:false, reason:'NO_COST', profit fields null); Görev 9 replaces
//             that block with the real per-item compute. The intermediate step is a
//             compiling, tested contract — not dead code — so the two görevler are
//             testable independently.
// update    → full-replace of the config fields on the list row (name only if given).
// selections → bulk toggle of the `included` flag: mode 'set' (per-row), 'all', 'none'.
// delete    → hard delete (cascades to items via the schema FK).
//
// Every query is scoped by organizationId + storeId (tenant isolation). Money is
// serialized to GROSS decimal strings; the frontend renders, never computes.

import { Decimal } from 'decimal.js';

import { Prisma, prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import { resolveCommissionRate } from './commission-rate-resolver';
import { resolveDiscountCommissionSource } from './discount-commission-source';
import {
  computeDiscountItem,
  type DiscountCommissionInputs,
  type TariffAssemblyContext,
  type TariffVariant,
} from './discount-compute.service';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import { NO_SHIPPING } from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';
import {
  discountConfigFromListRow,
  type DiscountCommissionBand,
  type DiscountListDetail,
  type DiscountListDetailItem,
  type DiscountListListItem,
  type DiscountSelection,
  type UpdateDiscountListBody,
} from '../validators/discount-list.validator';

/** String config alanını DiscountList Int kolonuna indirir (yoksa null). */
function intOrNull(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}

// ─── List ─────────────────────────────────────────────────────────────────────

/** Lists every saved discount list for a store with item + selected counts. */
export async function listDiscountLists(
  orgId: string,
  storeId: string,
): Promise<DiscountListListItem[]> {
  // Counts stay in the database: `_count` for the total and a `groupBy` for the selected
  // total per list — no item row ever crosses the ORM boundary just to be counted (the old
  // O(catalog) over-fetch). Both are store-scoped; the groupBy only returns lists with ≥1
  // included item, so a list absent from it has zero selected.
  let result;
  try {
    result = await Promise.all([
      prisma.discountList.findMany({
        where: { organizationId: orgId, storeId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          discountType: true,
          valueKind: true,
          value: true,
          minBasketAmount: true,
          minQuantity: true,
          buyQuantity: true,
          payQuantity: true,
          nthIndex: true,
          startsAt: true,
          endsAt: true,
          exportedAt: true,
          updatedAt: true,
          _count: { select: { items: true } },
        },
      }),
      prisma.discountListItem.groupBy({
        by: ['listId'],
        where: { organizationId: orgId, storeId, included: true },
        _count: true,
      }),
    ]);
  } catch (err) {
    mapPrismaError(err);
  }

  const [lists, selectedGroups] = result;
  const selectedByListId = new Map<string, number>();
  for (const group of selectedGroups) {
    selectedByListId.set(group.listId, group._count);
  }

  return lists.map((list): DiscountListListItem => {
    return {
      id: list.id,
      name: list.name,
      discountType: list.discountType,
      valueKind: list.valueKind,
      value: list.value !== null ? list.value.toFixed(2) : null,
      minBasketAmount: list.minBasketAmount !== null ? list.minBasketAmount.toFixed(2) : null,
      minQuantity: list.minQuantity,
      buyQuantity: list.buyQuantity,
      payQuantity: list.payQuantity,
      nthIndex: list.nthIndex,
      startsAt: list.startsAt !== null ? list.startsAt.toISOString() : null,
      endsAt: list.endsAt !== null ? list.endsAt.toISOString() : null,
      itemCount: list._count.items,
      selectedCount: selectedByListId.get(list.id) ?? 0,
      exported: list.exportedAt !== null,
      updatedAt: list.updatedAt.toISOString(),
    };
  });
}

// ─── Detail ─────────────────────────────────────────────────────────────────

/** The variant columns the detail compute reads — TariffVariant + its synced rate + image. */
interface DiscountVariantRow {
  id: string;
  stockCode: string;
  barcode: string;
  salePrice: Prisma.Decimal;
  vatRate: number | null;
  isDigital: boolean;
  syncedCommissionRate: Prisma.Decimal | null;
  product: {
    title: string;
    categoryId: bigint | null;
    brandId: bigint | null;
    images: { url: string }[];
  };
}

/**
 * Returns one discount list with its items, each carrying the current + discounted price
 * SCENARIOS computed on read. Throws `NotFoundError` when it does not belong to this
 * store. Resolves the store's latest commission tariff bands, batch-loads the matched
 * variants + their synced commission + cost + shipping + a category-rate fallback, then
 * runs the three-tier commission chain per item. Selection is EPHEMERAL client state, so
 * the detail returns no summary card — each item's `included` reflects the last SAVED
 * (downloaded) selection that the export path reads. Money math is Decimal, serialized at
 * the DTO edge (the frontend never computes).
 */
export async function getDiscountListDetail(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  listId: string,
): Promise<DiscountListDetail> {
  let list;
  try {
    list = await prisma.discountList.findFirst({
      where: { id: listId, organizationId: orgId, storeId },
      select: {
        id: true,
        name: true,
        discountType: true,
        valueKind: true,
        value: true,
        minBasketAmount: true,
        minQuantity: true,
        buyQuantity: true,
        payQuantity: true,
        nthIndex: true,
        startsAt: true,
        endsAt: true,
        exportedAt: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            productVariantId: true,
            barcode: true,
            modelCode: true,
            externalId: true,
            productTitle: true,
            brand: true,
            color: true,
            included: true,
            currentPrice: true,
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (list === null) {
    throw new NotFoundError('DiscountList', listId);
  }

  const config = discountConfigFromListRow(list);

  // ─── Batch-resolve matched variants + cost + shipping + image once ─────────
  const variantIds = list.items
    .map((i) => i.productVariantId)
    .filter((id): id is string => id !== null);

  const variantMap = new Map<string, DiscountVariantRow>();
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
          syncedCommissionRate: true,
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

  // ─── Resolve the commission tariff bands (1st tier), anchored to the campaign ──
  // start: bands are authoritative ONLY from a tariff week that COVERS the anchor
  // instant; no covering week → no bands (the per-item chain falls to product/category
  // rate). `outdated` is true only when the store has tariffs but none covers the
  // anchor. See discount-commission-source.ts.
  const { resolution: source, outdated: commissionTariffOutdated } =
    await resolveDiscountCommissionSource(orgId, storeId, list.startsAt, new Date());

  // ─── Category-rate fallback cache (3rd tier) — once per distinct (cat, brand) ──
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

  const items = list.items.map((item): DiscountListDetailItem => {
    const variantRow =
      item.productVariantId !== null ? variantMap.get(item.productVariantId) : undefined;
    const variant: TariffVariant | null = variantRow ?? null;
    const cost = item.productVariantId !== null ? costMap.get(item.productVariantId) : undefined;
    const shipping =
      item.productVariantId !== null
        ? (shippingMap.get(item.productVariantId) ?? NO_SHIPPING)
        : NO_SHIPPING;

    // Three-tier chain inputs: tariff bands (by barcode) → synced product rate → category.
    const bands = source?.bandsByBarcode.get(item.barcode) ?? null;
    // The commission-band ladder surfaced to the UI popover (the "which band does this
    // price land in?" popup). Reuses the bands ALREADY read for the compute — no extra
    // query. Serialized like advantage: money at 2 decimals, percent at 4. Null when
    // there is no ladder (no covering tariff week for the barcode).
    const commissionBands: DiscountCommissionBand[] | null =
      bands === null
        ? null
        : bands.map((band) => ({
            lowerLimit: band.lowerLimit !== null ? new Decimal(band.lowerLimit).toFixed(2) : null,
            upperLimit: band.upperLimit !== null ? new Decimal(band.upperLimit).toFixed(2) : null,
            commissionPct: new Decimal(band.commissionPct).toFixed(4),
          }));
    const productRate =
      variantRow !== undefined && variantRow.syncedCommissionRate !== null
        ? new Decimal(variantRow.syncedCommissionRate.toString())
        : null;
    const categoryRate =
      variantRow !== undefined && variantRow.product.categoryId !== null
        ? (categoryRateByKey.get(
            `${variantRow.product.categoryId}:${variantRow.product.brandId ?? 'null'}`,
          ) ?? null)
        : null;

    const commission: DiscountCommissionInputs = { bands, productRate, categoryRate };
    const computed = computeDiscountItem(
      ctx,
      variant,
      cost,
      shipping,
      commission,
      new Decimal(item.currentPrice.toString()),
      config,
    );

    return {
      id: item.id,
      barcode: item.barcode,
      modelCode: item.modelCode,
      externalId: item.externalId,
      productTitle: item.productTitle,
      brand: item.brand,
      color: item.color,
      imageUrl:
        item.productVariantId !== null ? (imageMap.get(item.productVariantId) ?? null) : null,
      included: item.included,
      calculable: computed.calculable,
      reason: computed.reason,
      current: serializeScenario(computed.current),
      discounted: serializeScenario(computed.discounted),
      commissionBands,
    };
  });

  // Selection is now EPHEMERAL client state: the detail returns no summary card. The frontend
  // derives the total product count from items.length and the selected count from its own local
  // state; each item's `included` still carries the last SAVED (downloaded) selection, which the
  // export path reads. So there is no server-side aggregation here.
  return {
    id: list.id,
    name: list.name,
    discountType: list.discountType,
    valueKind: list.valueKind,
    value: list.value !== null ? list.value.toFixed(2) : null,
    minBasketAmount: list.minBasketAmount !== null ? list.minBasketAmount.toFixed(2) : null,
    minQuantity: list.minQuantity,
    buyQuantity: list.buyQuantity,
    payQuantity: list.payQuantity,
    nthIndex: list.nthIndex,
    startsAt: list.startsAt !== null ? list.startsAt.toISOString() : null,
    endsAt: list.endsAt !== null ? list.endsAt.toISOString() : null,
    exported: list.exportedAt !== null,
    // Transparency: which tariff/period actually fed the bands (null when none resolved).
    commissionTariffName: source?.tariffName ?? null,
    commissionPeriodLabel: source?.periodLabel ?? null,
    // True only when the store has commission tariffs but none covers the anchor (uploads are
    // stale or don't reach the campaign start) — the detail warns the seller. See resolver.
    commissionTariffOutdated,
    items,
  };
}

/** Serializes a computed scenario (Decimal price) to the wire scenario (money 2dp). */
function serializeScenario(
  s: ReturnType<typeof computeDiscountItem>['current'],
): DiscountListDetailItem['current'] {
  return {
    price: s.price.toFixed(2),
    commissionPct: s.commissionPct,
    commissionSource: s.commissionSource,
    netProfit: s.netProfit,
    marginPct: s.marginPct,
  };
}

// ─── Update config ───────────────────────────────────────────────────────────

/**
 * Full-replaces the discount configuration on the list row (name only when provided).
 * `findFirst` first so a foreign list id is a 404 indistinguishable from a missing one.
 */
export async function updateDiscountList(
  orgId: string,
  storeId: string,
  listId: string,
  patch: UpdateDiscountListBody,
): Promise<{ id: string }> {
  const existing = await prisma.discountList.findFirst({
    where: { id: listId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (existing === null) {
    throw new NotFoundError('DiscountList', listId);
  }

  try {
    const updated = await prisma.discountList.update({
      where: { id: listId },
      data: {
        discountType: patch.discountType,
        valueKind: patch.valueKind ?? null,
        value: patch.value ?? null,
        minBasketAmount: patch.minBasketAmount ?? null,
        minQuantity: intOrNull(patch.minQuantity),
        buyQuantity: intOrNull(patch.buyQuantity),
        payQuantity: intOrNull(patch.payQuantity),
        nthIndex: intOrNull(patch.nthIndex),
        startsAt: patch.startsAt ?? null,
        endsAt: patch.endsAt ?? null,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
      },
      select: { id: true },
    });
    return { id: updated.id };
  } catch (err) {
    mapPrismaError(err);
  }
}

// ─── Update selections ─────────────────────────────────────────────────────────

/**
 * Toggles the `included` flag on list items. 404 when the list is not in this store.
 * mode 'all' / 'none' flips the WHOLE list in one `updateMany`; mode 'set' updates the
 * given rows in one bulk UPDATE gated on `(organization_id, store_id, list_id)`, so a
 * foreign itemId is silently skipped.
 */
export async function updateDiscountSelections(
  orgId: string,
  storeId: string,
  listId: string,
  selections: ReadonlyArray<DiscountSelection>,
  mode: 'set' | 'all' | 'none',
): Promise<{ updated: number }> {
  const list = await prisma.discountList.findFirst({
    where: { id: listId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (list === null) {
    throw new NotFoundError('DiscountList', listId);
  }

  if (mode === 'all' || mode === 'none') {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.discountListItem.updateMany({
          where: { listId, organizationId: orgId, storeId },
          data: { included: mode === 'all' },
        });
        // Bump the parent so `listDiscountLists` (ordered by updatedAt desc) floats the
        // edited list to the top — a selection save otherwise only touches item rows,
        // leaving the list reading as untouched. Ownership is proven by the findFirst above.
        await tx.discountList.update({
          where: { id: listId },
          data: { updatedAt: new Date() },
        });
        return result.count;
      });
      return { updated };
    } catch (err) {
      mapPrismaError(err);
    }
  }

  if (selections.length === 0) return { updated: 0 };

  // Dedupe last-wins: the same itemId may appear twice in one payload. A VALUES table with a
  // duplicate id would join the target row against both source rows, letting Postgres pick either
  // `included` nondeterministically — collapse to one row per id so the LAST choice always wins.
  const includedByItemId = new Map<string, boolean>();
  for (const s of selections) includedByItemId.set(s.itemId, s.included);
  const rows = [...includedByItemId].map(
    ([itemId, included]) => Prisma.sql`(${itemId}::uuid, ${included}::boolean)`,
  );

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const count = await tx.$executeRaw`
        UPDATE discount_list_items AS i
        SET included = v.included, updated_at = now()
        FROM (VALUES ${Prisma.join(rows)}) AS v(id, included)
        WHERE i.id = v.id
          AND i.organization_id = ${orgId}::uuid
          AND i.store_id = ${storeId}::uuid
          AND i.list_id = ${listId}::uuid
      `;
      // Same parent bump as the all/none path, so an edited list floats to the top of
      // `listDiscountLists` (ordered by updatedAt desc) instead of reading as untouched.
      await tx.discountList.update({
        where: { id: listId },
        data: { updatedAt: new Date() },
      });
      return count;
    });
    return { updated };
  } catch (err) {
    mapPrismaError(err);
  }
}

// ─── Delete ────────────────────────────────────────────────────────────────

/** Hard-deletes a discount list (items cascade). 404 when not in this store. */
export async function deleteDiscountList(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<void> {
  const existing = await prisma.discountList.findFirst({
    where: { id: listId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (existing === null) {
    throw new NotFoundError('DiscountList', listId);
  }

  try {
    await prisma.discountList.delete({ where: { id: listId } });
  } catch (err) {
    mapPrismaError(err);
  }
}
