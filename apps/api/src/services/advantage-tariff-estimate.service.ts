// On-demand profit estimate for a single Advantage tariff item.
//
// Backs two frontend surfaces without bloating the detail payload: the custom-price
// what-if and the current-scenario breakdown. It resolves the SAME inputs the detail
// resolves — cost, shipping, fee definitions, and the commission source bands /
// category fallback — but for ONE item, then runs the engine via
// `computeAdvantageEstimate`. No financial math lives here — the engine is reused, so
// the current-scenario breakdown matches the detail row's `current` byte-for-byte
// (same price = customer price, same current commission resolved the SAME way).
//
// Scoped by organizationId + storeId + tariff. A cross-tenant or foreign item id
// is indistinguishable from a missing one (404).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import type { EstimateOutcome } from '@pazarsync/profit';

import { NotFoundError } from '../lib/errors';
import { resolveCommissionRate } from './commission-rate-resolver';
import { fetchCostAggregates } from './products-list.service';
import { batchResolveShipping, resolveFeeDefs } from './product-pricing.service';
import {
  computeAdvantageEstimate,
  resolveCommission,
  type AdvantageEstimateCommission,
  type ItemCommissionInputs,
} from './advantage-tariff-compute.service';
import { resolveCommissionSource } from './advantage-tariff.service';
import {
  NO_SHIPPING,
  type TariffAssemblyContext,
  type TariffVariant,
} from './tariff-compute-commons';
import type { VariantCostAggregate } from '../validators/product.validator';
import type { EstimateAdvantagePriceResult } from '../validators/advantage-tariff.validator';

/**
 * Which scenario to price:
 *   - `price`   — an explicit price; the band it lands in (else the category rate)
 *                 supplies the reduced commission (the custom-price what-if).
 *   - `current` — the item's own customer price at its current commission — the "do
 *                 nothing" baseline the detail's `current` shows.
 */
export type EstimateAdvantagePriceInput =
  | { readonly mode: 'price'; readonly price: Decimal }
  | { readonly mode: 'current' };

/**
 * Computes the full profit breakdown for one advantage item under `input`. Throws
 * `NotFoundError` when the item does not belong to this tariff/store. In `current`
 * mode the price is the item's customer price and the commission is resolved EXACTLY
 * as the detail's current baseline (band, else category), so the breakdown equals the
 * detail row's `current.netProfit` byte-for-byte.
 */
export async function estimateAdvantageItemPrice(
  orgId: string,
  storeId: string,
  store: PrismaStore,
  tariffId: string,
  itemId: string,
  input: EstimateAdvantagePriceInput,
): Promise<EstimateAdvantagePriceResult> {
  let item;
  try {
    item = await prisma.advantageTariffItem.findFirst({
      where: { id: itemId, organizationId: orgId, storeId, tariffId },
      select: {
        id: true,
        productVariantId: true,
        barcode: true,
        customerPrice: true,
        tariff: { select: { commissionSourceTariffId: true } },
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('AdvantageTariffItem', itemId);
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

  // Resolve the commission for this barcode: source band, else category fallback.
  const source = await resolveCommissionSource(
    orgId,
    storeId,
    item.tariff.commissionSourceTariffId,
    new Date(),
  );
  const bands = source?.bandsByBarcode.get(item.barcode) ?? null;
  let categoryRate: Decimal | null = null;
  if (variant !== null && variant.product.categoryId !== null) {
    const resolved = await resolveCommissionRate({
      platform: store.platform,
      categoryId: variant.product.categoryId,
      brandId: variant.product.brandId,
      sellerSegment: null,
    });
    categoryRate = resolved?.rate ?? null;
  }
  const commissionInputs: ItemCommissionInputs = { bands, categoryRate };

  // Resolve the price + commission per mode. The 'current' scenario mirrors the detail
  // row's baseline EXACTLY: the customer price at the commission resolved the SAME way
  // (band, else category) at that price — injected as a verbatim override so the
  // breakdown equals `current.netProfit` byte-for-byte, with no second band lookup.
  const price = input.mode === 'current' ? new Decimal(item.customerPrice.toString()) : input.price;
  const commission: AdvantageEstimateCommission =
    input.mode === 'current'
      ? { kind: 'override', resolved: resolveCommission(commissionInputs, price) }
      : { kind: 'resolve', inputs: commissionInputs };

  const feeDefs = await prisma.$transaction((tx) => resolveFeeDefs(tx, store.platform));
  const ctx: TariffAssemblyContext = { platform: store.platform, feeDefs };

  const computed = computeAdvantageEstimate(ctx, variant, cost, shipping, commission, price);

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
