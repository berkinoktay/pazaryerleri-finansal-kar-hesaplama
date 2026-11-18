// On-demand profit estimate for a single Plus Commission Tariff item.
//
// Backs two frontend surfaces without bloating the detail payload: the custom-price
// what-if and the current-scenario breakdown. It loads the SAME scenario base the detail
// view uses (cost, shipping, fee + commission reference) but for ONE variant, then runs
// the profit engine via `computePlusEstimate`. No financial math lives here -- the engine
// is reused, so an estimate at the Plus ceiling matches the detail's `plus.netProfit` and
// the current-scenario breakdown matches the row's `currentNetProfit` (same price =
// commission-base price ?? current price, same current commission).
//
// Scoped by organizationId + storeId + tariff (via the item's period). A cross-tenant or
// foreign item id is indistinguishable from a missing one (404). A pathological engine
// input degrades to a logged not-calculable result rather than a 500 (decision 9). The
// current scenario of an item with no known baseline price (neither a commission-base
// price nor a current price) has nothing to price: it answers 422 on `scenario`
// (CURRENT_PRICE_UNKNOWN) instead of pricing a made-up 0. The price mode needs no stored
// price, so it works with an unknown Plus price upper limit too. A commission percent the
// file left blank or unreadable is never priced at a made-up 0%: the current scenario of an
// item with an unknown current percent answers 422 on `scenario`
// (CURRENT_COMMISSION_UNKNOWN), and the price mode of an item with an unknown Plus
// commission offer answers 422 on `price` (PLUS_COMMISSION_UNKNOWN). Each mode checks only
// the percent it applies.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError, ValidationError } from '../lib/errors';
import {
  computePlusEstimate,
  type ComputedPlusEstimate,
} from './plus-commission-tariff-compute.service';
import { logProfitReadFailure } from './profit-compute-fallback.service';
import {
  loadScreenScenarioBases,
  resolveScreenVariantId,
  screenScenarioBaseFor,
} from './scenario-screen-commons';
import { currentBaselinePrice, decimalOrNull } from './tariff-compute-commons';
import type { EstimatePlusPriceResult } from '../validators/plus-commission-tariff.validator';

/**
 * Which scenario to price:
 *   - `price`   — an explicit price under the item's reduced Plus commission.
 *   - `current` — the item's own commission-base price at its current commission —
 *                 the "do nothing" baseline the detail shows. Its current sale price
 *                 stands in when the commission-base price is unknown.
 */
export type EstimatePlusPriceInput =
  | { readonly mode: 'price'; readonly price: Decimal }
  | { readonly mode: 'current' };

/**
 * Computes the full profit breakdown for one Plus item under `input`. Throws
 * `NotFoundError` when the item does not belong to this tariff/store. When the item's
 * barcode has no catalog variant now, or the variant is uncostable, the result carries
 * `calculable: false` + a `reason` and a null breakdown. Throws `ValidationError` (`scenario`, CURRENT_PRICE_UNKNOWN)
 * for the current scenario of an item whose baseline price is unknown
 * (`currentBaselinePrice` is null), (`scenario`, CURRENT_COMMISSION_UNKNOWN) for the
 * current scenario of an item whose current commission percent is unknown (the price
 * check comes first), and (`price`, PLUS_COMMISSION_UNKNOWN) for the price mode of an
 * item whose Plus commission offer is unknown.
 */
export async function estimatePlusItemPrice(
  orgId: string,
  storeId: string,
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
        barcode: true,
        currentPrice: true,
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
  // detail row's baseline EXACTLY: the commission-base price (customer-seen price,
  // or the current sale price when it is unknown) at the item's CURRENT commission,
  // so the breakdown equals `currentNetProfit`. With no baseline price, or with an
  // unknown current commission percent, the detail row has no current profit either,
  // so there is nothing to break down: refuse before loading the scenario bases. The
  // price mode applies the Plus commission offer; an unknown offer has no profit in the
  // detail either, so it is refused the same way.
  const price = input.mode === 'current' ? currentBaselinePrice(item) : input.price;
  if (price === null) {
    throw new ValidationError([{ field: 'scenario', code: 'CURRENT_PRICE_UNKNOWN' }]);
  }
  let applyCommissionPct: Decimal;
  if (input.mode === 'current') {
    const currentCommissionPct = decimalOrNull(item.currentCommissionPct);
    if (currentCommissionPct === null) {
      throw new ValidationError([{ field: 'scenario', code: 'CURRENT_COMMISSION_UNKNOWN' }]);
    }
    applyCommissionPct = currentCommissionPct;
  } else {
    const plusCommissionPct = decimalOrNull(item.plusCommissionPct);
    if (plusCommissionPct === null) {
      throw new ValidationError([{ field: 'price', code: 'PLUS_COMMISSION_UNKNOWN' }]);
    }
    applyCommissionPct = plusCommissionPct;
  }

  // Resolve the item's variant from its barcode as the catalog is now (the same lookup
  // the detail uses, never the link stored at import), then load the scenario base for
  // that variant only (scenario date = now). A barcode with no catalog variant passes no
  // ids -> no-product; a failed lookup (logged) or a store-wide load failure -> degraded.
  const { variantId, degraded } = await resolveScreenVariantId({
    organizationId: orgId,
    storeId,
    barcode: item.barcode,
    surface: 'plus-commission-tariff',
  });
  const bases = await loadScreenScenarioBases({
    organizationId: orgId,
    storeId,
    scenarioDate: new Date(),
    variantIds: variantId !== null ? [variantId] : [],
    surface: 'plus-commission-tariff',
  });
  const base = screenScenarioBaseFor(bases, variantId, degraded);

  let computed: ComputedPlusEstimate;
  try {
    computed = computePlusEstimate({ applyCommissionPct, base, price });
  } catch (err) {
    logProfitReadFailure({
      surface: 'plus-commission-tariff',
      organizationId: orgId,
      orderId: null,
      err,
    });
    computed = computePlusEstimate({ applyCommissionPct, base: { kind: 'degraded' }, price });
  }

  return {
    itemId: item.id,
    price: price.toFixed(2),
    // Current scenario echoes the item's (known) current commission in the detail wire
    // format (4dp) so the modal header matches the row; the price mode surfaces the Plus
    // percent.
    commissionPct:
      input.mode === 'current' ? applyCommissionPct.toFixed(4) : computed.commissionPct,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
  };
}
