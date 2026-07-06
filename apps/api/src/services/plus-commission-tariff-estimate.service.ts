// On-demand profit estimate for a single Plus Commission Tariff item.
//
// Backs two frontend surfaces without bloating the detail payload: the custom-price
// what-if and the current-scenario breakdown. It resolves the SAME inputs the detail
// view resolves (cost, shipping, fee definitions) but for ONE item, then runs the
// profit engine via `computePlusEstimate`. No financial math lives here — the engine
// is reused, so an estimate at the Plus ceiling matches the detail's `plus.netProfit`
// and the current-scenario breakdown matches the row's `currentNetProfit`.
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
import { computePlusEstimate } from './plus-commission-tariff-compute.service';
import {
  NO_SHIPPING,
  type TariffAssemblyContext,
  type TariffVariant,
} from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';
import type { EstimatePlusPriceResult } from '../validators/plus-commission-tariff.validator';

/**
 * Which scenario to price:
 *   - `price`   — an explicit price under the item's reduced Plus commission.
 *   - `current` — the item's own commission-base price at its current commission —
 *                 the "do nothing" baseline the detail shows.
 */
export type EstimatePlusPriceInput =
  | { readonly mode: 'price'; readonly price: Decimal }
  | { readonly mode: 'current' };

/**
 * Computes the full profit breakdown for one Plus item under `input`. Throws
 * `NotFoundError` when the item does not belong to this tariff/store. When the item
 * is unmatched or uncostable the result carries `calculable: false` + a `reason`
 * and a null breakdown.
 */
export async function estimatePlusItemPrice(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  tariffId: string,
  itemId: string,
  input: EstimatePlusPriceInput,
): Promise<EstimatePlusPriceResult> {
  let item;
  try {
    item = await prisma.plusCommissionTariffItem.findFirst({
      // `period: { tariffId }` ties the item to THIS tariff — an item id from
      // another tariff (even in this store) is treated as missing.
      where: { id: itemId, organizationId: orgId, storeId, period: { tariffId } },
      select: {
        id: true,
        productVariantId: true,
        commissionBasePrice: true,
        currentCommissionPct: true,
        plusCommissionPct: true,
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('PlusCommissionTariffItem', itemId);
  }

  // Resolve the price + commission per mode. The 'current' scenario mirrors the
  // detail row's baseline EXACTLY: the commission-base price (customer-seen price)
  // at the item's CURRENT commission — so the breakdown equals `currentNetProfit`.
  const price =
    input.mode === 'current' ? new Decimal(item.commissionBasePrice.toString()) : input.price;
  const applyCommissionPct =
    input.mode === 'current'
      ? new Decimal(item.currentCommissionPct.toString())
      : new Decimal(item.plusCommissionPct.toString());

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

  const computed = computePlusEstimate(ctx, applyCommissionPct, variant, cost, shipping, price);

  return {
    itemId: item.id,
    price: price.toFixed(2),
    // Current scenario echoes the item's commission in the detail wire format (4dp)
    // so the modal header matches the row; the price mode surfaces the Plus percent.
    commissionPct:
      input.mode === 'current' ? item.currentCommissionPct.toFixed(4) : computed.commissionPct,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
  };
}
