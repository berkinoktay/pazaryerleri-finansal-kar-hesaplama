// On-demand profit estimate for a single Flash Products item.
//
// Backs two frontend surfaces without bloating the detail payload: the custom-price
// what-if and the current-scenario breakdown. It resolves the SAME inputs the detail
// resolves — cost, shipping, fee definitions, and the item's PRIMARY window commission
// bands — but for ONE item, then runs the engine via `computeFlashEstimate`. No
// financial math lives here; the current-scenario breakdown matches the detail row's
// current baseline byte-for-byte (same price = customer price, same commission = the
// flat "Mevcut Komisyon" rate).
//
// Scoped by organizationId + storeId + list. A cross-tenant or foreign item id is
// indistinguishable from a missing one (404).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import { buildFlashCommissionResolver } from './flash-product-commission.service';
import {
  computeFlashEstimate,
  type FlashEstimateCommission,
} from './flash-product-compute.service';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import {
  NO_SHIPPING,
  type TariffAssemblyContext,
  type TariffVariant,
} from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';
import type { EstimateFlashPriceResult } from '../validators/flash-product.validator';

/**
 * Which scenario to price:
 *   - `price`   — an explicit price; the band it lands in (of the item's primary window),
 *                 else the flat rate, supplies the reduced commission (custom-price what-if).
 *   - `current` — the item's own customer price at its current commission — the "do
 *                 nothing" baseline the detail's current fields show.
 */
export type EstimateFlashPriceInput =
  | { readonly mode: 'price'; readonly price: Decimal }
  | { readonly mode: 'current' };

/**
 * Computes the full profit breakdown for one flash item under `input`. Throws
 * `NotFoundError` when the item does not belong to this list/store. In `current` mode
 * the price is the item's customer price and the commission is the flat "Mevcut
 * Komisyon" rate, so the breakdown equals the detail row's current baseline exactly.
 */
export async function estimateFlashItemPrice(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  listId: string,
  itemId: string,
  input: EstimateFlashPriceInput,
): Promise<EstimateFlashPriceResult> {
  let item;
  try {
    item = await prisma.flashProductItem.findFirst({
      where: { id: itemId, organizationId: orgId, storeId, listId },
      select: {
        id: true,
        productVariantId: true,
        barcode: true,
        customerPrice: true,
        currentCommissionPct: true,
        hasCommissionTariff: true,
        offer24StartsAt: true,
        offer3StartsAt: true,
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('FlashProductItem', itemId);
  }

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

  // Resolve the item's PRIMARY window bands (offer24Start ?? offer3Start) once — the
  // same source the detail uses for the custom-price estimate and the ⓘ popover.
  const primaryStart = item.offer24StartsAt ?? item.offer3StartsAt;
  const resolver = await buildFlashCommissionResolver(
    orgId,
    storeId,
    item.hasCommissionTariff ? [{ startsAt: primaryStart, barcode: item.barcode }] : [],
  );
  const primaryBands = resolver.bandsFor(primaryStart, item.barcode, item.hasCommissionTariff);

  const flatPct = new Decimal(item.currentCommissionPct.toString());
  const price = input.mode === 'current' ? new Decimal(item.customerPrice.toString()) : input.price;
  const commission: FlashEstimateCommission =
    input.mode === 'current'
      ? { kind: 'override', pct: flatPct }
      : { kind: 'resolve', bands: primaryBands, flatPct };

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));
  const ctx: TariffAssemblyContext = { platform: store.platform, feeDefs };

  const computed = computeFlashEstimate(ctx, variant, cost, shipping, commission, price);

  return {
    itemId: item.id,
    price: price.toFixed(2),
    commissionPct: computed.commissionPct,
    commissionSource: computed.commissionSource,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
  };
}
