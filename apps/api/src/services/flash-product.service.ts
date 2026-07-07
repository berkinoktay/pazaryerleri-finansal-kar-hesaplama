// Read + delete + selections service for the Flash Products (Flaş Ürünler) feature.
//
// list   → one row per saved flash upload (product / item / selected counts, exported).
// detail → the list with per-item, per-scenario profit COMPUTED on read. The reduced
//          commission of each offer is READ from the store's Commission Tariff — the
//          offer's window resolves into a commission BAND, else the flat "Mevcut
//          Komisyon" rate (see flash-product-commission). Resolved in ONE batch per
//          detail so the same (week, period) is not re-queried per date row.
// delete → hard delete (cascades to items via the schema FK).
// updateSelections → bulk offer choice XOR custom price.
//
// Every query is scoped by organizationId + storeId (tenant isolation). Money is
// serialized to GROSS decimal strings; the frontend renders, never computes.

import { Decimal } from 'decimal.js';

import { Prisma, prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import type { StoredBand } from './commission-tariff.types';
import {
  buildFlashCommissionResolver,
  type FlashCommissionRequest,
} from './flash-product-commission.service';
import { computeFlashItem, type FlashOfferInput } from './flash-product-compute.service';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import {
  NO_SHIPPING,
  type TariffAssemblyContext,
  type TariffVariant,
} from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';
import type {
  FlashCommissionBand,
  FlashProductDetail,
  FlashProductDetailItem,
  FlashProductListItem,
  FlashSelection,
} from '../validators/flash-product.validator';

/** Serializes a resolved band ladder for the wire (money 2dp, percent 4dp), or null. */
function serializeFlashBands(
  bands: ReadonlyArray<StoredBand> | null,
): FlashCommissionBand[] | null {
  if (bands === null) return null;
  return bands.map((band) => ({
    lowerLimit: band.lowerLimit !== null ? new Decimal(band.lowerLimit).toFixed(2) : null,
    upperLimit: band.upperLimit !== null ? new Decimal(band.upperLimit).toFixed(2) : null,
    commissionPct: new Decimal(band.commissionPct).toFixed(4),
  }));
}

// ─── List ───────────────────────────────────────────────────────────────────

/** Lists every saved flash upload for a store with product / item / selected counts. */
export async function listFlashProducts(
  orgId: string,
  storeId: string,
): Promise<FlashProductListItem[]> {
  let lists;
  try {
    lists = await prisma.flashProductList.findMany({
      where: { organizationId: orgId, storeId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        exportedAt: true,
        updatedAt: true,
        items: { select: { barcode: true, selectedOffer: true, customPrice: true } },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  return lists.map((list): FlashProductListItem => {
    const barcodes = new Set<string>();
    let selectedCount = 0;
    for (const item of list.items) {
      barcodes.add(item.barcode);
      // A row counts as selected when it has a chosen offer OR a custom price.
      if (item.selectedOffer !== null || item.customPrice !== null) selectedCount += 1;
    }
    return {
      id: list.id,
      name: list.name,
      productCount: barcodes.size,
      itemCount: list.items.length,
      selectedCount,
      exported: list.exportedAt !== null,
      updatedAt: list.updatedAt.toISOString(),
    };
  });
}

// ─── Detail ──────────────────────────────────────────────────────────────────

/**
 * Returns one flash list with per-item, per-scenario profit computed on read. Throws
 * `NotFoundError` when it does not belong to this store. Batch-resolves variants + cost
 * + shipping + images and every offer window's commission source once, then computes
 * each item by reusing the product-pricing assembly.
 */
export async function getFlashProductDetail(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  listId: string,
): Promise<FlashProductDetail> {
  let list;
  try {
    list = await prisma.flashProductList.findFirst({
      where: { id: listId, organizationId: orgId, storeId },
      select: {
        id: true,
        name: true,
        exportedAt: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            productVariantId: true,
            modelCode: true,
            barcode: true,
            productTitle: true,
            category: true,
            brand: true,
            stock: true,
            externalId: true,
            currentPrice: true,
            customerPrice: true,
            currentCommissionPct: true,
            hasCommissionTariff: true,
            offer24Price: true,
            offer24StartsAt: true,
            offer24EndsAt: true,
            offer3Price: true,
            offer3StartsAt: true,
            offer3EndsAt: true,
            selectedOffer: true,
            customPrice: true,
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (list === null) {
    throw new NotFoundError('FlashProductList', listId);
  }

  const now = new Date();

  // ─── Batch-resolve matched variants + cost + shipping + image once ────────
  const variantIds = list.items
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

  // ─── Resolve every offer window's commission source in ONE batch ──────────
  const requests: FlashCommissionRequest[] = [];
  for (const item of list.items) {
    if (!item.hasCommissionTariff) continue;
    if (item.offer24Price !== null) {
      requests.push({ startsAt: item.offer24StartsAt, barcode: item.barcode });
    }
    if (item.offer3Price !== null) {
      requests.push({ startsAt: item.offer3StartsAt, barcode: item.barcode });
    }
  }
  const resolver = await buildFlashCommissionResolver(orgId, storeId, requests);

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));
  const ctx: TariffAssemblyContext = { platform: store.platform, feeDefs };

  const items = list.items.map((item): FlashProductDetailItem => {
    const variant =
      item.productVariantId !== null ? variantMap.get(item.productVariantId) : undefined;
    const cost = item.productVariantId !== null ? costMap.get(item.productVariantId) : undefined;
    const shipping =
      item.productVariantId !== null
        ? (shippingMap.get(item.productVariantId) ?? NO_SHIPPING)
        : NO_SHIPPING;

    const offer24: FlashOfferInput | null =
      item.offer24Price !== null
        ? {
            price: new Decimal(item.offer24Price.toString()),
            startsAt: item.offer24StartsAt,
            endsAt: item.offer24EndsAt,
            bands: resolver.bandsFor(item.offer24StartsAt, item.barcode, item.hasCommissionTariff),
          }
        : null;
    const offer3: FlashOfferInput | null =
      item.offer3Price !== null
        ? {
            price: new Decimal(item.offer3Price.toString()),
            startsAt: item.offer3StartsAt,
            endsAt: item.offer3EndsAt,
            bands: resolver.bandsFor(item.offer3StartsAt, item.barcode, item.hasCommissionTariff),
          }
        : null;

    // Primary window = the 24h offer's start, else the 3h offer's — drives the surfaced
    // band ladder + the custom-price estimate (design MİMARİ KARAR 2).
    const primaryStart = item.offer24StartsAt ?? item.offer3StartsAt;
    const primaryBands = resolver.bandsFor(primaryStart, item.barcode, item.hasCommissionTariff);

    const computed = computeFlashItem(
      ctx,
      {
        currentCommissionPct: new Decimal(item.currentCommissionPct.toString()),
        customerPrice: new Decimal(item.customerPrice.toString()),
        offer24,
        offer3,
        primaryBands,
      },
      now,
      variant ?? null,
      cost,
      shipping,
    );

    return {
      id: item.id,
      barcode: item.barcode,
      modelCode: item.modelCode,
      productTitle: item.productTitle,
      imageUrl:
        item.productVariantId !== null ? (imageMap.get(item.productVariantId) ?? null) : null,
      category: item.category,
      brand: item.brand,
      stock: item.stock,
      externalId: item.externalId,
      currentPrice: item.currentPrice.toFixed(2),
      customerPrice: item.customerPrice.toFixed(2),
      currentCommissionPct: new Decimal(item.currentCommissionPct.toString()).toFixed(4),
      currentNetProfit: computed.currentNetProfit,
      currentMarginPct: computed.currentMarginPct,
      calculable: computed.calculable,
      reason: computed.reason,
      hasCommissionTariff: item.hasCommissionTariff,
      commissionSource: computed.commissionSource,
      commissionBands: serializeFlashBands(computed.commissionBands),
      offer24: computed.offer24,
      offer3: computed.offer3,
      selectedOffer: item.selectedOffer,
      customPrice: item.customPrice !== null ? item.customPrice.toFixed(2) : null,
    };
  });

  return {
    id: list.id,
    name: list.name,
    exported: list.exportedAt !== null,
    items,
  };
}

// ─── Delete ────────────────────────────────────────────────────────────────

/** Hard-deletes a flash list (items cascade). 404 when not in this store. */
export async function deleteFlashProductList(
  orgId: string,
  storeId: string,
  listId: string,
): Promise<void> {
  const existing = await prisma.flashProductList.findFirst({
    where: { id: listId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (existing === null) {
    throw new NotFoundError('FlashProductList', listId);
  }

  try {
    await prisma.flashProductList.delete({ where: { id: listId } });
  } catch (err) {
    mapPrismaError(err);
  }
}

// ─── Save selections ─────────────────────────────────────────────────────────

/**
 * Persists the seller's offer choice (H24 / H3) XOR custom price in ONE bulk UPDATE.
 * 404 when the list is not in this store. Each row is gated on
 * `(organization_id, store_id, list_id)`, so a foreign itemId is silently skipped.
 */
export async function updateFlashSelections(
  orgId: string,
  storeId: string,
  listId: string,
  selections: ReadonlyArray<FlashSelection>,
): Promise<{ updated: number }> {
  const list = await prisma.flashProductList.findFirst({
    where: { id: listId, organizationId: orgId, storeId },
    select: { id: true },
  });
  if (list === null) {
    throw new NotFoundError('FlashProductList', listId);
  }
  if (selections.length === 0) return { updated: 0 };

  const rows = selections.map(
    (s) => Prisma.sql`(${s.itemId}::uuid, ${s.offer}::"FlashOfferType", ${s.customPrice}::numeric)`,
  );

  try {
    const updated = await prisma.$executeRaw`
      UPDATE flash_product_items AS i
      SET selected_offer = v.offer, custom_price = v.custom_price, updated_at = now()
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, offer, custom_price)
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
