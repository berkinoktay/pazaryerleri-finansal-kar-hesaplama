// On-demand profit estimate for a single İndirimler (discount list) item.
//
// Backs the breakdown modal without bloating the detail payload. It resolves the SAME
// inputs the detail resolves for ONE item — the three-tier commission chain (the store's
// latest commission tariff bands, the variant's synced commission, the category rate),
// cost, shipping, and fee definitions — then runs the engine via `computeDiscountEstimate`.
// No financial math lives here; the chosen scenario's breakdown matches the detail row's
// matching scenario byte-for-byte (same price, same resolved commission).
//
// Scoped by organizationId + storeId + list. A cross-tenant or foreign item id is
// indistinguishable from a missing one (404).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import { resolveCommissionSource } from './advantage-tariff.service';
import { resolveCommissionRate } from './commission-rate-resolver';
import {
  computeDiscountEstimate,
  effectiveUnitPrice,
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
  type EstimateDiscountItemResult,
} from '../validators/discount-list.validator';

/** Which of the detail row's two scenarios to price. */
export type DiscountEstimateScenario = 'current' | 'discounted';

/**
 * Computes the full profit breakdown for one discount item under `scenario`. Throws
 * `NotFoundError` when the item does not belong to this list/store. `current` prices the
 * item's current price; `discounted` prices effectiveUnitPrice(currentPrice, config) —
 * the list config comes from the item's list row via `discountConfigFromListRow`, so the
 * two config bridges share one truth. The commission is re-resolved at the chosen price.
 */
export async function estimateDiscountItem(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  listId: string,
  itemId: string,
  scenario: DiscountEstimateScenario,
): Promise<EstimateDiscountItemResult> {
  let item;
  try {
    item = await prisma.discountListItem.findFirst({
      where: { id: itemId, organizationId: orgId, storeId, listId },
      select: {
        id: true,
        productVariantId: true,
        barcode: true,
        currentPrice: true,
        list: {
          select: {
            discountType: true,
            valueKind: true,
            value: true,
            minBasketAmount: true,
            minQuantity: true,
            buyQuantity: true,
            payQuantity: true,
            nthIndex: true,
          },
        },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('DiscountListItem', itemId);
  }

  const config = discountConfigFromListRow(item.list);
  const currentPrice = new Decimal(item.currentPrice.toString());
  const price = scenario === 'current' ? currentPrice : effectiveUnitPrice(currentPrice, config);

  // Resolve the matched variant + its synced rate + cost + shipping + category rate once
  // (only when the item matched a catalog variant).
  let variant: TariffVariant | null = null;
  let productRate: Decimal | null = null;
  let categoryRate: Decimal | null = null;
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
          syncedCommissionRate: true,
          product: { select: { title: true, categoryId: true, brandId: true } },
        },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    variant = variantRow;
    if (variantRow !== null && variantRow.syncedCommissionRate !== null) {
      productRate = new Decimal(variantRow.syncedCommissionRate.toString());
    }

    const [costMap, shippingMap] = await Promise.all([
      fetchCostAggregates(orgId, [item.productVariantId]),
      batchResolveShipping(orgId, storeId, [item.productVariantId]),
    ]);
    cost = costMap.get(item.productVariantId);
    shipping = shippingMap.get(item.productVariantId) ?? NO_SHIPPING;

    if (variantRow !== null && variantRow.product.categoryId !== null) {
      const resolved = await resolveCommissionRate({
        platform: store.platform,
        categoryId: variantRow.product.categoryId,
        brandId: variantRow.product.brandId,
        sellerSegment: null,
      });
      categoryRate = resolved?.rate ?? null;
    }
  }

  // Bands come from the store's LATEST commission tariff (its active/nearest period),
  // matched by barcode — the same source the detail view uses.
  let latestTariff;
  try {
    latestTariff = await prisma.commissionTariff.findFirst({
      where: { organizationId: orgId, storeId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  const source =
    latestTariff !== null
      ? await resolveCommissionSource(orgId, storeId, latestTariff.id, new Date())
      : null;
  const bands = source?.bandsByBarcode.get(item.barcode) ?? null;

  const commission: DiscountCommissionInputs = { bands, productRate, categoryRate };

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));
  const ctx: TariffAssemblyContext = { platform: store.platform, feeDefs };

  const computed = computeDiscountEstimate(ctx, variant, cost, shipping, commission, price);

  return {
    itemId: item.id,
    scenario,
    price: price.toFixed(2),
    commissionPct: computed.commissionPct,
    commissionSource: computed.commissionSource,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
  };
}
