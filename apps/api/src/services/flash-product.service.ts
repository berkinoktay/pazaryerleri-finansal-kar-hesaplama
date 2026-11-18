// Read + delete + selections service for the Flash Products (Flas Urunler) feature.
//
// list   -> one row per saved flash upload (product / item / selected counts, exported).
// detail -> the list with per-item, per-scenario profit COMPUTED on read. The reduced
//          commission of each offer is READ from the store's Commission Tariff -- the
//          offer's window resolves into a commission BAND, else the flat "Mevcut
//          Komisyon" rate (see flash-product-commission). Resolved in ONE batch per
//          detail so the same (week, period) is not re-queried per date row.
// delete -> hard delete (cascades to items via the schema FK).
// updateSelections -> bulk offer choice XOR custom price.
//
// Every query is scoped by organizationId + storeId (tenant isolation). Money is
// serialized to GROSS decimal strings; the frontend renders, never computes.

import { Decimal } from 'decimal.js';

import { Prisma, prisma } from '@pazarsync/db';
import type { FlashOfferType } from '@pazarsync/db/enums';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError, ValidationError, type ValidationIssue } from '../lib/errors';
import { assertScopedWrite } from '../workbooks/scoped-write';
import {
  buildFlashCommissionResolver,
  type FlashCommissionRequest,
} from './flash-product-commission.service';
import {
  computeFlashItem,
  type ComputedFlashItem,
  type FlashOfferInput,
} from './flash-product-compute.service';
import {
  createRequestFailureLog,
  loadScreenScenarioBases,
  resolveScreenVariantIds,
  screenScenarioBaseFor,
  serializeCommissionBandLadder,
} from './scenario-screen-commons';
import { decimalOrNull, percentOrNull } from './tariff-compute-commons';
import type {
  FlashProductDetail,
  FlashProductDetailItem,
  FlashProductListItem,
  FlashSelection,
} from '../validators/flash-product.validator';

// --- List ---

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

// --- Detail ---

/**
 * Returns one flash list with per-item, per-scenario profit computed on read. Throws
 * `NotFoundError` when it does not belong to this store. Each item's variant is resolved
 * from its barcode as the store's catalog is now (one query for the whole list,
 * `resolveScreenVariantIds`), not from the link stored at import. Loads every resolved
 * variant's scenario base in one pass and every offer window's commission source once, then
 * computes each item with the scenario engine (the resolved band / flat rate handed in as
 * the commission override). A slim org + store scoped variant query supplies the display
 * image only. Per decision 9 a failed barcode lookup, a store-wide load failure or a
 * per-item engine throw leaves that profit empty (logged once) rather than failing the
 * request. The stored current commission percent (the flat rate) is read through
 * `decimalOrNull` / `percentOrNull`: an unknown percent (the file's cell was blank or
 * unreadable) is sent as a null `currentCommissionPct` and is never priced
 * (`computeFlashItem` decides what it leaves computable: an offer a tariff band covers
 * keeps its profit).
 */
export async function getFlashProductDetail(
  orgId: string,
  storeId: string,
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

  // --- Resolve every item barcode to its catalog variant, once ---
  // The variant comes from the item's barcode as the catalog is now (one org + store
  // scoped query; a list holds several offer rows per product and the lookup dedups
  // them), never from the link stored at import. A failed lookup is logged and degrades
  // every item (no ids, so the variant reads below are skipped).
  const { variantIdByBarcode, degraded } = await resolveScreenVariantIds({
    organizationId: orgId,
    storeId,
    barcodes: list.items.map((i) => i.barcode),
    surface: 'flash-product',
  });
  const variantIds = [...new Set(variantIdByBarcode.values())];

  // --- Resolved variant image (slim, org + store scoped) ---
  // The first catalog image is the only field the detail needs from the variant -- the
  // profit inputs come from the scenario loader below, not from this query.
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

  // --- Resolve every offer window's commission source in ONE batch ---
  const requests: FlashCommissionRequest[] = [];
  for (const item of list.items) {
    if (!item.hasCommissionTariff) continue;
    if (item.offer24Price !== null) {
      requests.push({
        startsAt: item.offer24StartsAt,
        endsAt: item.offer24EndsAt,
        barcode: item.barcode,
      });
    }
    if (item.offer3Price !== null) {
      requests.push({
        startsAt: item.offer3StartsAt,
        endsAt: item.offer3EndsAt,
        barcode: item.barcode,
      });
    }
  }
  const resolver = await buildFlashCommissionResolver(orgId, storeId, requests);

  // --- One scenario-base load for the whole list; scenario date = now ---
  const bases = await loadScreenScenarioBases({
    organizationId: orgId,
    storeId,
    scenarioDate: now,
    variantIds,
    surface: 'flash-product',
  });

  // A per-item engine throw degrades only that item; collect and log once (decision 9).
  const failureLog = createRequestFailureLog({ surface: 'flash-product', organizationId: orgId });

  const items = list.items.map((item): FlashProductDetailItem => {
    const variantId = variantIdByBarcode.get(item.barcode) ?? null;
    const base = screenScenarioBaseFor(bases, variantId, degraded);

    const offer24: FlashOfferInput | null =
      item.offer24Price !== null
        ? {
            price: new Decimal(item.offer24Price.toString()),
            startsAt: item.offer24StartsAt,
            endsAt: item.offer24EndsAt,
            bands: resolver.bandsFor(
              item.offer24StartsAt,
              item.offer24EndsAt,
              item.barcode,
              item.hasCommissionTariff,
            ),
          }
        : null;
    const offer3: FlashOfferInput | null =
      item.offer3Price !== null
        ? {
            price: new Decimal(item.offer3Price.toString()),
            startsAt: item.offer3StartsAt,
            endsAt: item.offer3EndsAt,
            bands: resolver.bandsFor(
              item.offer3StartsAt,
              item.offer3EndsAt,
              item.barcode,
              item.hasCommissionTariff,
            ),
          }
        : null;

    // Primary window = the 24h offer's window, else the 3h offer's -- drives the surfaced
    // band ladder + the custom-price estimate (design MIMARI KARAR 2). Resolved on the
    // window's END (see flash-product-commission).
    const primaryStart = item.offer24StartsAt ?? item.offer3StartsAt;
    const primaryEnd = item.offer24StartsAt !== null ? item.offer24EndsAt : item.offer3EndsAt;
    const primaryBands = resolver.bandsFor(
      primaryStart,
      primaryEnd,
      item.barcode,
      item.hasCommissionTariff,
    );

    const flashInput = {
      // Null when the file's current commission cell was blank or unreadable.
      currentCommissionPct: decimalOrNull(item.currentCommissionPct),
      customerPrice: new Decimal(item.customerPrice.toString()),
      offer24,
      offer3,
      primaryBands,
    };
    let computed: ComputedFlashItem;
    try {
      computed = computeFlashItem({ input: flashInput, now, base });
    } catch (err) {
      failureLog.record(err);
      computed = computeFlashItem({ input: flashInput, now, base: { kind: 'degraded' } });
    }

    return {
      id: item.id,
      barcode: item.barcode,
      modelCode: item.modelCode,
      productTitle: item.productTitle,
      imageUrl: variantId !== null ? (imageMap.get(variantId) ?? null) : null,
      category: item.category,
      brand: item.brand,
      stock: item.stock,
      externalId: item.externalId,
      currentPrice: item.currentPrice.toFixed(2),
      customerPrice: item.customerPrice.toFixed(2),
      currentCommissionPct: percentOrNull(item.currentCommissionPct),
      currentNetProfit: computed.currentNetProfit,
      currentMarginPct: computed.currentMarginPct,
      calculable: computed.calculable,
      reason: computed.reason,
      hasCommissionTariff: item.hasCommissionTariff,
      commissionSource: computed.commissionSource,
      // null-in / null-out: the flat fallback carries no ladder (see computeFlashItem).
      commissionBands:
        computed.commissionBands === null
          ? null
          : serializeCommissionBandLadder(computed.commissionBands),
      offer24: computed.offer24,
      offer3: computed.offer3,
      selectedOffer: item.selectedOffer,
      customPrice: item.customPrice !== null ? item.customPrice.toFixed(2) : null,
    };
  });

  failureLog.flush();

  return {
    id: list.id,
    name: list.name,
    exported: list.exportedAt !== null,
    items,
  };
}

// --- Delete ---

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

  await assertScopedWrite(
    prisma.flashProductList.deleteMany({
      where: { id: listId, organizationId: orgId, storeId },
    }),
    'FlashProductList',
    listId,
  );
}

// --- Save selections ---

interface FlashOfferPrices {
  readonly offer24Price: Prisma.Decimal | null;
  readonly offer3Price: Prisma.Decimal | null;
}

/** The stored price column of each flash offer; a null price means the row lacks the offer. */
const OFFER_PRICE_COLUMN: Record<FlashOfferType, keyof FlashOfferPrices> = {
  H24: 'offer24Price',
  H3: 'offer3Price',
};

/** The lowest offer price the item stores (the custom price ceiling), or null with none. */
function lowestOfferPrice(item: FlashOfferPrices): Decimal | null {
  let lowest: Decimal | null = null;
  for (const column of Object.values(OFFER_PRICE_COLUMN)) {
    const price = decimalOrNull(item[column]);
    if (price !== null && (lowest === null || price.lt(lowest))) lowest = price;
  }
  return lowest;
}

/**
 * Refuses, all-or-nothing, a selection the export could not write. Each entry with an
 * offer or a custom price (an entry with both null is never checked) whose item is in this
 * list and store must name an offer the item stores (`OFFER_NOT_STORED` on
 * `selections.<index>.offer`). A custom price needs an item that stores at least one offer
 * (`OFFER_NOT_STORED` on `selections.<index>.customPrice`: there is no ceiling to check
 * against) and may not exceed the item's lowest offer price (`CUSTOM_PRICE_ABOVE_MAX` on
 * `selections.<index>.customPrice`; a price equal to it is allowed). The index is the one
 * of the request array, and the issues come back together in one `ValidationError` (422).
 * An item id outside the list/store scope is not checked, so a foreign item never shows up
 * in an error (non-disclosure); the UPDATE skips it.
 */
async function assertFlashSelectionsWritable(
  orgId: string,
  storeId: string,
  listId: string,
  selections: ReadonlyArray<FlashSelection>,
): Promise<void> {
  const ids = selections
    .filter((selection) => selection.offer !== null || selection.customPrice !== null)
    .map((selection) => selection.itemId);
  if (ids.length === 0) return;

  let items;
  try {
    items = await prisma.flashProductItem.findMany({
      // `listId` ties each item to THIS list, exactly as the UPDATE does.
      where: { id: { in: ids }, organizationId: orgId, storeId, listId },
      select: { id: true, offer24Price: true, offer3Price: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  // Postgres compares uuids whatever their letter case and returns them lower case, so
  // the lookup is keyed lower case: an upper-case item id is checked, not skipped.
  const itemsById = new Map(items.map((item) => [item.id.toLowerCase(), item]));
  const issues: ValidationIssue[] = [];
  for (const [index, selection] of selections.entries()) {
    const item = itemsById.get(selection.itemId.toLowerCase());
    if (item === undefined) continue;

    const prefix = `selections.${index.toString()}`;
    if (selection.offer !== null && item[OFFER_PRICE_COLUMN[selection.offer]] === null) {
      issues.push({ field: `${prefix}.offer`, code: 'OFFER_NOT_STORED' });
    }
    if (selection.customPrice === null) continue;

    const ceiling = lowestOfferPrice(item);
    if (ceiling === null) {
      issues.push({ field: `${prefix}.customPrice`, code: 'OFFER_NOT_STORED' });
    } else if (new Decimal(selection.customPrice).gt(ceiling)) {
      issues.push({ field: `${prefix}.customPrice`, code: 'CUSTOM_PRICE_ABOVE_MAX' });
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(issues);
  }
}

/**
 * Persists the seller's offer choice (H24 / H3) XOR custom price in ONE bulk UPDATE.
 * 404 when the list is not in this store. Before writing, `assertFlashSelectionsWritable`
 * refuses (422, nothing written) an offer the item does not store, a custom price on an
 * item with no offer, or a custom price above the item's lowest offer price. Each row is
 * gated on `(organization_id, store_id, list_id)`, so a foreign itemId is silently skipped
 * (not updated, not reported).
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

  await assertFlashSelectionsWritable(orgId, storeId, listId, selections);

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
