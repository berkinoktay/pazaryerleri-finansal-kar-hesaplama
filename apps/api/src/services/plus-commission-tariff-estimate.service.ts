// On-demand profit estimate for a single Plus Commission Tariff item.
//
// Backs the custom-price what-if without bloating the detail payload: it resolves
// the SAME inputs the detail view resolves (cost, shipping, fee definitions) but
// for ONE item, then runs the profit engine at the requested price under the
// item's reduced Plus commission via `computePlusEstimate`. No financial math
// lives here — the engine is reused.
//
// Scoped by organizationId + storeId + tariff. A cross-tenant or foreign item id
// is indistinguishable from a missing one (404).

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

/** Which commission the breakdown is computed under: the seller's current rate, or the reduced Plus rate. */
export type EstimateScenario = 'current' | 'plus';

/**
 * Computes the full profit breakdown for one Plus item at `price` under the
 * chosen scenario's commission (`current` = the seller's current rate, `plus` =
 * the reduced Plus rate — the default). Throws `NotFoundError` when the item does
 * not belong to this tariff/store. When the item is unmatched or uncostable the
 * result carries `calculable: false` + a `reason` and a null breakdown.
 */
export async function estimatePlusItemPrice(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  tariffId: string,
  itemId: string,
  price: Decimal,
  scenario: EstimateScenario = 'plus',
): Promise<EstimatePlusPriceResult> {
  let item;
  try {
    item = await prisma.plusCommissionTariffItem.findFirst({
      where: { id: itemId, organizationId: orgId, storeId, tariffId },
      select: {
        id: true,
        productVariantId: true,
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

  const applyCommissionPct = new Decimal(
    (scenario === 'current' ? item.currentCommissionPct : item.plusCommissionPct).toString(),
  );
  const computed = computePlusEstimate(ctx, applyCommissionPct, variant, cost, shipping, price);

  return {
    itemId: item.id,
    price: price.toFixed(2),
    commissionPct: computed.commissionPct,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
  };
}
