// On-demand profit estimate for a single Flash Products item.
//
// Backs two frontend surfaces without bloating the detail payload: the custom-price
// what-if and the current-scenario breakdown. It resolves the SAME inputs the detail
// resolves -- the scenario base (cost, shipping, fee + commission reference) and the
// item's PRIMARY window commission bands -- but for ONE item (its variant resolved from
// its barcode at read time, as the detail does), then runs the scenario engine via
// `computeFlashEstimate`. No financial math lives here; the current-scenario
// breakdown matches the detail row's current baseline byte-for-byte (same price =
// customer price, same commission = the flat "Mevcut Komisyon" rate).
//
// Scoped by organizationId + storeId + list. A cross-tenant or foreign item id is
// indistinguishable from a missing one (404). A pathological engine input degrades to a
// logged not-calculable result rather than a 500 (decision 9).
//
// A "Mevcut Komisyon" cell the file left blank or unreadable is stored as an unknown (null)
// flat rate and never priced at a made-up 0%. The current scenario of such an item answers
// 422 on `scenario` (CURRENT_COMMISSION_UNKNOWN), like the detail row that has no current
// profit. The price mode does not refuse it: whether the flat rate is needed depends on the
// typed price (a price that lands in a tariff band uses that band's rate), so a price that
// falls back to the unknown flat rate answers 200, not calculable, with a null commission.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';

import { NotFoundError, ValidationError } from '../lib/errors';
import { buildFlashCommissionResolver } from './flash-product-commission.service';
import {
  computeFlashEstimate,
  type ComputedFlashEstimate,
  type FlashEstimateCommission,
} from './flash-product-compute.service';
import { logProfitReadFailure } from './profit-compute-fallback.service';
import {
  loadScreenScenarioBases,
  resolveScreenVariantId,
  screenScenarioBaseFor,
} from './scenario-screen-commons';
import { decimalOrNull } from './tariff-compute-commons';
import type { EstimateFlashPriceResult } from '../validators/flash-product.validator';

/**
 * Which scenario to price:
 *   - `price`   -- an explicit price; the band it lands in (of the item's primary window),
 *                 else the flat rate, supplies the reduced commission (custom-price what-if).
 *   - `current` -- the item's own customer price at its current commission -- the "do
 *                 nothing" baseline the detail's current fields show.
 */
export type EstimateFlashPriceInput =
  | { readonly mode: 'price'; readonly price: Decimal }
  | { readonly mode: 'current' };

/**
 * Computes the full profit breakdown for one flash item under `input`. Throws
 * `NotFoundError` when the item does not belong to this list/store. In `current` mode
 * the price is the item's customer price and the commission is the flat "Mevcut
 * Komisyon" rate, so the breakdown equals the detail row's current baseline exactly;
 * throws `ValidationError` (`scenario`, CURRENT_COMMISSION_UNKNOWN) when that rate is
 * unknown. In `price` mode an unknown flat rate is not an error: a price that falls back
 * to it answers not calculable with a null reason, commission and breakdown.
 */
export async function estimateFlashItemPrice(
  orgId: string,
  storeId: string,
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
        barcode: true,
        customerPrice: true,
        currentCommissionPct: true,
        hasCommissionTariff: true,
        offer24StartsAt: true,
        offer24EndsAt: true,
        offer3StartsAt: true,
        offer3EndsAt: true,
      },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  if (item === null) {
    throw new NotFoundError('FlashProductItem', itemId);
  }

  // Resolve the item's PRIMARY window bands (offer24 window ?? offer3 window) once -- the
  // same source the detail uses for the custom-price estimate and the info popover. The
  // window resolves on its END (see flash-product-commission).
  const primaryStart = item.offer24StartsAt ?? item.offer3StartsAt;
  const primaryEnd = item.offer24StartsAt !== null ? item.offer24EndsAt : item.offer3EndsAt;
  const resolver = await buildFlashCommissionResolver(
    orgId,
    storeId,
    item.hasCommissionTariff
      ? [{ startsAt: primaryStart, endsAt: primaryEnd, barcode: item.barcode }]
      : [],
  );
  const primaryBands = resolver.bandsFor(
    primaryStart,
    primaryEnd,
    item.barcode,
    item.hasCommissionTariff,
  );

  // The flat "Mevcut Komisyon" rate; null when the file's cell was blank or unreadable.
  // The current scenario prices it verbatim, so an unknown rate is refused there (the
  // detail row has no current profit either) before the scenario base is loaded. The
  // price mode hands it on unchanged: a price in a tariff band never needs it, and a price
  // that falls back to it comes back not calculable from `computeFlashEstimate`.
  const flatPct = decimalOrNull(item.currentCommissionPct);
  const price = input.mode === 'current' ? new Decimal(item.customerPrice.toString()) : input.price;
  let commission: FlashEstimateCommission;
  if (input.mode === 'current') {
    if (flatPct === null) {
      throw new ValidationError([{ field: 'scenario', code: 'CURRENT_COMMISSION_UNKNOWN' }]);
    }
    commission = { kind: 'override', pct: flatPct };
  } else {
    commission = { kind: 'resolve', bands: primaryBands, flatPct };
  }

  // Resolve the item's variant from its barcode as the catalog is now (the same lookup
  // the detail uses, never the link stored at import), then load the scenario base for
  // that variant only (scenario date = now). A barcode with no catalog variant passes no
  // ids -> no-product; a failed lookup (logged) or a store-wide load failure -> degraded.
  const { variantId, degraded } = await resolveScreenVariantId({
    organizationId: orgId,
    storeId,
    barcode: item.barcode,
    surface: 'flash-product',
  });
  const bases = await loadScreenScenarioBases({
    organizationId: orgId,
    storeId,
    scenarioDate: new Date(),
    variantIds: variantId !== null ? [variantId] : [],
    surface: 'flash-product',
  });
  const base = screenScenarioBaseFor(bases, variantId, degraded);

  let computed: ComputedFlashEstimate;
  try {
    computed = computeFlashEstimate({ base, commission, price });
  } catch (err) {
    logProfitReadFailure({
      surface: 'flash-product',
      organizationId: orgId,
      orderId: null,
      err,
    });
    computed = computeFlashEstimate({ base: { kind: 'degraded' }, commission, price });
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
