// On-demand profit estimate for a single Commission Tariff item.
//
// Backs three frontend surfaces without bloating the detail payload: the band-click
// breakdown modal, the custom-price what-if, and the current-scenario breakdown. It
// loads the SAME scenario base the detail view uses (cost, shipping, fee + commission
// reference) but for ONE variant, then runs the profit engine via `computeItemEstimate`.
// No financial math lives here -- the engine is reused, so an estimate at a band's price
// matches that band's profit in the detail response, and the current-scenario breakdown
// matches the detail row's `currentNetProfit` (same price = commission-base price ??
// sale price, same current commission).
//
// Scoped by organizationId + storeId + tariff (via the item's period). A cross-tenant or
// foreign item id is indistinguishable from a missing one (404). A pathological engine
// input degrades to a logged not-calculable result rather than a 500 (decision 9). The
// current scenario of an item with no known baseline price (neither a commission-base
// price nor a current price) has nothing to price: it answers 422 on `scenario`
// (CURRENT_PRICE_UNKNOWN) instead of pricing a made-up 0. The current scenario of an item
// whose current commission percent is unknown (the file's cell was blank or unreadable)
// answers 422 on `scenario` (CURRENT_COMMISSION_UNKNOWN) instead of pricing a made-up 0%;
// the band and custom-price modes never read that percent, so they are unaffected.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import { mapPrismaError } from '@pazarsync/sync-core';
import { parseStoredTariffBands } from '@pazarsync/profit';

import { NotFoundError, ValidationError } from '../lib/errors';
import {
  computeItemEstimate,
  type ComputedEstimate,
  type EstimateCommission,
} from './commission-tariff-compute.service';
import { logProfitReadFailure } from './profit-compute-fallback.service';
import {
  loadScreenScenarioBases,
  resolveScreenVariantId,
  screenScenarioBaseFor,
} from './scenario-screen-commons';
import { currentBaselinePrice, decimalOrNull } from './tariff-compute-commons';
import type { EstimateItemPriceResult } from '../validators/commission-tariff.validator';

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
 * -disclosure). When the item's barcode has no catalog variant now, or the variant is
 * uncostable, the result carries
 * `calculable: false` + a `reason` and a null breakdown — never an error. Throws
 * `ValidationError` (`scenario`, CURRENT_PRICE_UNKNOWN) for the current scenario of an
 * item whose baseline price is unknown (`currentBaselinePrice` is null), and
 * (`scenario`, CURRENT_COMMISSION_UNKNOWN) for the current scenario of an item whose
 * current commission percent is unknown; the price check comes first.
 */
export async function estimateItemPrice(
  orgId: string,
  storeId: string,
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
        barcode: true,
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
  // CURRENT commission — so the breakdown equals `currentNetProfit` byte-for-byte. With
  // no baseline price, or with an unknown current commission percent, the detail row has
  // no current profit either, so there is nothing to break down: refuse before loading
  // the scenario bases. The band and custom-price modes never read the current percent.
  const price = input.mode === 'current' ? currentBaselinePrice(item) : input.price;
  if (price === null) {
    throw new ValidationError([{ field: 'scenario', code: 'CURRENT_PRICE_UNKNOWN' }]);
  }
  let commission: EstimateCommission;
  if (input.mode === 'current') {
    const currentCommissionPct = decimalOrNull(item.currentCommissionPct);
    if (currentCommissionPct === null) {
      throw new ValidationError([{ field: 'scenario', code: 'CURRENT_COMMISSION_UNKNOWN' }]);
    }
    commission = { kind: 'override', commissionPct: currentCommissionPct };
  } else {
    commission = { kind: 'band', bandKey: input.bandKey };
  }

  const bands = parseStoredTariffBands(item.bands);

  // Resolve the item's variant from its barcode as the catalog is now (the same lookup
  // the detail uses, never the link stored at import), then load the scenario base for
  // that variant only (scenario date = now). A barcode with no catalog variant passes no
  // ids -> no-product; a failed lookup (logged) or a store-wide load failure -> degraded.
  const { variantId, degraded } = await resolveScreenVariantId({
    organizationId: orgId,
    storeId,
    barcode: item.barcode,
    surface: 'commission-tariff',
  });
  const bases = await loadScreenScenarioBases({
    organizationId: orgId,
    storeId,
    scenarioDate: new Date(),
    variantIds: variantId !== null ? [variantId] : [],
    surface: 'commission-tariff',
  });
  const base = screenScenarioBaseFor(bases, variantId, degraded);

  let computed: ComputedEstimate;
  try {
    computed = computeItemEstimate({ bands, base, price, commission });
  } catch (err) {
    logProfitReadFailure({
      surface: 'commission-tariff',
      organizationId: orgId,
      orderId: null,
      err,
    });
    computed = computeItemEstimate({ bands, base: { kind: 'degraded' }, price, commission });
  }

  return {
    itemId: item.id,
    price: price.toFixed(2),
    bandKey: computed.bandKey,
    // Current scenario echoes the item's (known) commission in the detail wire format
    // (4dp) so the breakdown modal's header matches the row; band/price modes surface the
    // applied band's raw percent string (e.g. "15").
    commissionPct:
      commission.kind === 'override' ? commission.commissionPct.toFixed(4) : computed.commissionPct,
    calculable: computed.calculable,
    reason: computed.reason,
    breakdown: computed.breakdown,
  };
}
