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

import { Prisma, prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError } from '../lib/errors';
import type {
  DiscountListDetail,
  DiscountListDetailItem,
  DiscountListListItem,
  DiscountSelection,
  UpdateDiscountListBody,
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
  let lists;
  try {
    lists = await prisma.discountList.findMany({
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
        orderLimit: true,
        startsAt: true,
        endsAt: true,
        exportedAt: true,
        updatedAt: true,
        items: { select: { included: true } },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return lists.map((list): DiscountListListItem => {
    let selectedCount = 0;
    for (const item of list.items) {
      if (item.included) selectedCount += 1;
    }
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
      orderLimit: list.orderLimit,
      startsAt: list.startsAt !== null ? list.startsAt.toISOString() : null,
      endsAt: list.endsAt !== null ? list.endsAt.toISOString() : null,
      itemCount: list.items.length,
      selectedCount,
      exported: list.exportedAt !== null,
      updatedAt: list.updatedAt.toISOString(),
    };
  });
}

// ─── Detail ─────────────────────────────────────────────────────────────────

/**
 * Returns one discount list with its items. Throws `NotFoundError` when it does not
 * belong to this store. Batch-loads the matched variant's primary image by
 * `productVariantId`. The per-scenario profit is a FIXED placeholder in Görev 8 — see
 * the `Task 9 replaces:` markers below.
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
        orderLimit: true,
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
            buyboxStatus: true,
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

  // ─── Batch-resolve the matched variant's primary image once ────────────────
  const variantIds = list.items
    .map((i) => i.productVariantId)
    .filter((id): id is string => id !== null);

  const imageMap = new Map<string, string | null>();
  if (variantIds.length > 0) {
    let variants;
    try {
      variants = await prisma.productVariant.findMany({
        where: { id: { in: variantIds }, organizationId: orgId, storeId },
        select: {
          id: true,
          product: {
            select: { images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 } },
          },
        },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    for (const variant of variants) {
      imageMap.set(variant.id, variant.product.images[0]?.url ?? null);
    }
  }

  let selectedCount = 0;
  const items = list.items.map((item): DiscountListDetailItem => {
    if (item.included) selectedCount += 1;
    const price = item.currentPrice.toFixed(2);
    // Task 9 replaces: the current/discounted scenarios are fixed placeholders here —
    // both prices equal the current price and every profit field is null until the real
    // per-item compute (computeDiscountItems) lands. Görev 9 swaps this whole block.
    const scenario = {
      price,
      commissionPct: null,
      commissionSource: null,
      netProfit: null,
      marginPct: null,
    };
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
      buyboxStatus: item.buyboxStatus,
      included: item.included,
      calculable: false,
      reason: 'NO_COST',
      current: scenario,
      discounted: scenario,
    };
  });

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
    orderLimit: list.orderLimit,
    startsAt: list.startsAt !== null ? list.startsAt.toISOString() : null,
    endsAt: list.endsAt !== null ? list.endsAt.toISOString() : null,
    exported: list.exportedAt !== null,
    // Task 9 replaces: perOrderCost / maxTotalCost / avgProfitDelta are fixed placeholders
    // until the real cost aggregation lands. itemCount + selectedCount are real already.
    summary: {
      itemCount: list.items.length,
      selectedCount,
      perOrderCost: '0.00',
      maxTotalCost: null,
      avgProfitDelta: null,
    },
    items,
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
        orderLimit: intOrNull(patch.orderLimit),
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
      const result = await prisma.discountListItem.updateMany({
        where: { listId, organizationId: orgId, storeId },
        data: { included: mode === 'all' },
      });
      return { updated: result.count };
    } catch (err) {
      mapPrismaError(err);
    }
  }

  if (selections.length === 0) return { updated: 0 };

  const rows = selections.map((s) => Prisma.sql`(${s.itemId}::uuid, ${s.included}::boolean)`);

  try {
    const updated = await prisma.$executeRaw`
      UPDATE discount_list_items AS i
      SET included = v.included, updated_at = now()
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, included)
      WHERE i.id = v.id
        AND i.organization_id = ${orgId}::uuid
        AND i.store_id = ${storeId}::uuid
        AND i.list_id = ${listId}::uuid
    `;
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
