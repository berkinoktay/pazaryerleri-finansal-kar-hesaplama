// On-demand profit estimate for a single Advantage tariff item.
//
// Backs two frontend surfaces without bloating the detail payload: the custom-price
// what-if and the current-scenario breakdown. It resolves the SAME inputs the detail
// resolves -- the scenario base (cost, shipping, fee + commission reference) and the
// commission source bands / category fallback -- but for ONE item, then runs the scenario
// engine via `computeAdvantageEstimate`. No financial math lives here -- the engine is
// reused, so the current-scenario breakdown matches the detail row's `current`
// byte-for-byte (same price = customer price, same current commission resolved the SAME
// way).
//
// Scoped by organizationId + storeId + tariff. A cross-tenant or foreign item id
// is indistinguishable from a missing one (404). A pathological engine input degrades to
// a logged not-calculable result rather than a 500 (decision 9).

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Store as PrismaStore } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError } from '../lib/errors';
import {
  computeAdvantageEstimate,
  resolveCommission,
  type AdvantageEstimateCommission,
  type ComputedAdvantageEstimate,
  type ItemCommissionInputs,
} from './advantage-tariff-compute.service';
import { resolveCommissionSource } from './advantage-tariff.service';
import { logProfitReadFailure } from './profit-compute-fallback.service';
import {
  loadScreenScenarioBases,
  resolveScreenVariantId,
  screenScenarioBaseFor,
  resolveCategoryRate,
} from './scenario-screen-commons';
import type { EstimateAdvantagePriceResult } from '../validators/advantage-tariff.validator';

/**
 * Which scenario to price:
 *   - `price`   -- an explicit price; the band it lands in (else the category rate)
 *                 supplies the reduced commission (the custom-price what-if).
 *   - `current` -- the item's own customer price at its current commission -- the "do
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

  // Resolve the item's variant from its barcode as the catalog is now (the same lookup
  // the detail uses, never the link stored at import). A barcode with no catalog variant
  // resolves to null; so does a failed lookup (logged), which degrades the item.
  const { variantId, degraded } = await resolveScreenVariantId({
    organizationId: orgId,
    storeId,
    barcode: item.barcode,
    surface: 'advantage-tariff',
  });

  // Slim category/brand read for the resolved variant (feeds the category fallback rate).
  // The profit inputs come from the scenario loader below, not from this query.
  let category: { categoryId: bigint | null; brandId: bigint | null } | null = null;
  if (variantId !== null) {
    let variantRow;
    try {
      variantRow = await prisma.productVariant.findFirst({
        where: { id: variantId, organizationId: orgId, storeId },
        select: { product: { select: { categoryId: true, brandId: true } } },
      });
    } catch (err) {
      mapPrismaError(err);
    }
    category =
      variantRow !== null
        ? { categoryId: variantRow.product.categoryId, brandId: variantRow.product.brandId }
        : null;
  }

  // Resolve the commission for this barcode: source band, else category fallback.
  const source = await resolveCommissionSource(
    orgId,
    storeId,
    item.tariff.commissionSourceTariffId,
    new Date(),
  );
  const bands = source?.bandsByBarcode.get(item.barcode) ?? null;
  const categoryRate = await resolveCategoryRate({ platform: store.platform, ref: category });
  const commissionInputs: ItemCommissionInputs = { bands, categoryRate };

  // Resolve the price + commission per mode. The 'current' scenario mirrors the detail
  // row's baseline EXACTLY: the customer price at the commission resolved the SAME way
  // (band, else category) at that price -- injected as a verbatim override so the
  // breakdown equals `current.netProfit` byte-for-byte, with no second band lookup.
  const price = input.mode === 'current' ? new Decimal(item.customerPrice.toString()) : input.price;
  const commission: AdvantageEstimateCommission =
    input.mode === 'current'
      ? { kind: 'override', resolved: resolveCommission(commissionInputs, price) }
      : { kind: 'resolve', inputs: commissionInputs };

  // Load the scenario base for the resolved variant only (scenario date = now). A barcode
  // with no catalog variant passes no ids -> no-product; a failed lookup or a store-wide
  // load failure -> degraded.
  const bases = await loadScreenScenarioBases({
    organizationId: orgId,
    storeId,
    scenarioDate: new Date(),
    variantIds: variantId !== null ? [variantId] : [],
    surface: 'advantage-tariff',
  });
  const base = screenScenarioBaseFor(bases, variantId, degraded);

  let computed: ComputedAdvantageEstimate;
  try {
    computed = computeAdvantageEstimate({ base, commission, price });
  } catch (err) {
    logProfitReadFailure({
      surface: 'advantage-tariff',
      organizationId: orgId,
      orderId: null,
      err,
    });
    computed = computeAdvantageEstimate({ base: { kind: 'degraded' }, commission, price });
  }

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
