// On-demand profit estimate for a single Commission Tariff item.
//
// Backs three frontend surfaces without bloating the detail payload: the band-click
// breakdown modal, the custom-price what-if, and the current-scenario breakdown.
// It resolves the SAME inputs the detail view resolves (cost, shipping, fee
// definitions) but for ONE item, then runs the profit engine via
// `computeItemEstimate`. No financial math lives here — the engine is reused, so an
// estimate at a band's price matches that band's profit in the detail response, and
// the current-scenario breakdown matches the detail row's `currentNetProfit`
// (same price = commission-base price ?? sale price, same current commission).
//
// Scoped by organizationId + storeId + tariff (via the item's period). A cross
// -tenant or foreign item id is indistinguishable from a missing one (404).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import {
  computeItemEstimate,
  type EstimateCommission,
  type TariffAssemblyContext,
  type TariffVariant,
} from './commission-tariff-compute.service';
import { parseStoredBands } from './commission-tariff.types';
import type { VariantCostAggregate } from '../validators/product.validator';
import type { EstimateItemPriceResult } from '../validators/commission-tariff.validator';

// A variant the resolvers could not place degrades to not-calculable (same
// sentinel the detail service uses).
const NO_SHIPPING: EstimateOutcome = { ok: false, reason: 'STORE_NOT_FOUND' };

/**
 * Which scenario to price:
 *   - `price`   — an explicit price; `bandKey` (when set) applies that band's
 *                 commission verbatim, otherwise the band is derived from price.
 *   - `current` — the item's own commission-base price (or sale price) at its
 *                 current commission — the "do nothing" baseline the detail shows.
 */
export type EstimateItemPriceInput =
  | { readonly mode: 'price'; readonly price: Decimal; readonly bandKey: string | null }
  | { readonly mode: 'current' };

/**
 * Computes the full profit breakdown for one tariff item under `input`. Throws
 * `NotFoundError` when the item does not belong to this tariff/store (non
 * -disclosure). When the item is unmatched or uncostable the result carries
 * `calculable: false` + a `reason` and a null breakdown — never an error.
 */
export async function estimateItemPrice(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  tariffId: string,
  itemId: string,
  input: EstimateItemPriceInput,
): Promise<EstimateItemPriceResult> {
  let item;
  try {
    item = await prisma.commissionTariffItem.findFirst({
      // `period: { tariffId }` ties the item to THIS tariff — an item id from
      // another tariff (even in this store) is treated as missing.
      where: { id: itemId, organizationId: orgId, storeId, period: { tariffId } },
      select: {
        id: true,
        productVariantId: true,
        bands: true,
        currentPrice: true,
        commissionBasePrice: true,
        currentCommissionPct: true,
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('CommissionTariffItem', itemId);
  }

  // Resolve the price + commission source per mode. The 'current' scenario mirrors
  // the detail row's baseline EXACTLY: the commission-base price (customer-seen
  // price, or the sale price when the column predates the import) at the item's
  // CURRENT commission — so the breakdown equals `currentNetProfit` byte-for-byte.
  const price =
    input.mode === 'current'
      ? new Decimal((item.commissionBasePrice ?? item.currentPrice).toString())
      : input.price;
  const commission: EstimateCommission =
    input.mode === 'current'
      ? { kind: 'override', commissionPct: new Decimal(item.currentCommissionPct.toString()) }
      : { kind: 'band', bandKey: input.bandKey };

  const bands = parseStoredBands(item.bands);

  // Resolve the matched variant + cost + shipping once (only when matched).
  let variant: TariffVariant | null = null;
  let cost: VariantCostAggregate | undefined;
  let shipping: EstimateOutcome = NO_SHIPPING;

  if (item.productVariantId !== null) {
    let variantRow;
    try {
      variantRow = await prisma.productVariant.findFirst({
        where: { id: item.productVariantId, organizationId: orgId, storeId },
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
    variant = variantRow;

    const [costMap, shippingMap] = await Promise.all([
      fetchCostAggregates(orgId, [item.productVariantId]),
      batchResolveShipping(orgId, storeId, [item.productVariantId]),
    ]);
    cost = costMap.get(item.productVariantId);
    shipping = shippingMap.get(item.productVariantId) ?? NO_SHIPPING;
  }

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));
  const ctx: TariffAssemblyContext = { platform: store.platform, feeDefs };

  const computed = computeItemEstimate(ctx, bands, variant, cost, shipping, price, commission);

  return {
    itemId: item.id,
    price: price.toFixed(2),
    bandKey: computed.bandKey,
    // Current scenario echoes the item's commission in the detail wire format (4dp)
    // so the breakdown modal's header matches the row; band/price modes surface the
    // applied band's raw percent string (e.g. "15").
    commissionPct:
      input.mode === 'current' ? item.currentCommissionPct.toFixed(4) : computed.commissionPct,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
  };
}
