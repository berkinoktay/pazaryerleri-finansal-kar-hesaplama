// On-demand profit estimate for a single Commission Tariff item.
//
// Backs two frontend surfaces without bloating the detail payload: the band-click
// breakdown modal and the custom-price what-if. It resolves the SAME inputs the
// detail view resolves (cost, shipping, fee definitions) but for ONE item, then
// runs the profit engine at the requested price via `computeItemEstimate`. No
// financial math lives here — the engine is reused, so an estimate at a band's
// price matches that band's profit in the detail response exactly.
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
  type TariffAssemblyContext,
  type TariffVariant,
} from './commission-tariff-compute.service';
import { parseStoredBands } from './commission-tariff.types';
import type { VariantCostAggregate } from '../validators/product.validator';
import type { EstimateItemPriceResult } from '../validators/commission-tariff.validator';

// A variant the resolvers could not place degrades to not-calculable (same
// sentinel the detail service uses).
const NO_SHIPPING: EstimateOutcome = { ok: false, reason: 'STORE_NOT_FOUND' };

export interface EstimateItemPriceInput {
  price: Decimal;
  /** When set, that band's commission is used verbatim; otherwise derived from price. */
  bandKey: string | null;
}

/**
 * Computes the full profit breakdown for one tariff item at `input.price`.
 * Throws `NotFoundError` when the item does not belong to this tariff/store
 * (non-disclosure). When the item is unmatched or uncostable the result carries
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
      select: { id: true, productVariantId: true, bands: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('CommissionTariffItem', itemId);
  }

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

  const computed = computeItemEstimate(
    ctx,
    bands,
    variant,
    cost,
    shipping,
    input.price,
    input.bandKey,
  );

  return {
    itemId: item.id,
    price: input.price.toFixed(2),
    bandKey: computed.bandKey,
    commissionPct: computed.commissionPct,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
  };
}
