import { Decimal } from 'decimal.js';
import {
  ProfitIssueCode,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ShippingTariffSource,
} from '@pazarsync/db/enums';

import {
  activeItems,
  type ParcelItemSnapshot,
  type ParcelSnapshot,
} from '../../core/parcel-snapshot';
import { type ProfitIssue } from '../../core/profit-issue';
import { createProfitLine, type LineMoney, type ProfitLine } from '../../core/profit-line';
import { grossFromNet, vatFromGross } from '../../tax/tr/vat';
import {
  type TrendyolParcelAttributes,
  type TrendyolReferenceData,
  type TrendyolShippingTariff,
} from './trendyol-inputs';

const ZERO = new Decimal(0);

/** The SHIPPING-line input reason recorded when an order's carrier is not recognized. */
export const CARRIER_NOT_RECOGNIZED_REASON = 'CARRIER_NOT_RECOGNIZED';

/** Why a shipping amount could not be resolved for a parcel or a standalone item. */
export type ShippingUnavailableReason =
  | 'UNKNOWN_DESI'
  | 'NO_CARRIER'
  | 'DESI_OVERFLOW'
  | 'OWN_CONTRACT_EMPTY';

/** Which leg of the tariff tree produced the shipping net amount. */
export type ShippingTariffKind = 'BAREM' | 'DESI' | 'OWN';

/** How the parcel desi was obtained: measured by the carrier or summed from products. */
type ParcelDesiSource = 'MEASURED' | 'PRODUCTS';

type ShippingNetResult =
  | { readonly ok: true; readonly net: Decimal; readonly kind: ShippingTariffKind }
  | { readonly ok: false; readonly reason: ShippingUnavailableReason };

type ShippingGrossResult =
  | { readonly ok: true; readonly gross: Decimal; readonly kind: ShippingTariffKind }
  | { readonly ok: false; readonly reason: ShippingUnavailableReason };

/**
 * The parcel desi for a shipping estimate. The marketplace-measured desi wins when
 * present; otherwise the desi is the SUM of `unitDesi x quantity` over the active,
 * non-digital items (the total, never the quantity-weighted average). Digital items
 * do not ship (plan decision 11b), so they never add to the desi and their unknown
 * desi never makes the result unknown. The result is `null` when an active
 * non-digital item has an unknown desi or there is no active item to sum.
 */
export function parcelDesi(
  snapshot: ParcelSnapshot,
): { readonly desi: Decimal; readonly source: ParcelDesiSource } | null {
  if (snapshot.measuredDesi !== null) {
    return { desi: snapshot.measuredDesi, source: 'MEASURED' };
  }

  const items = activeItems(snapshot);
  if (items.length === 0) {
    return null;
  }

  let total = ZERO;
  for (const item of items) {
    if (item.isDigital) {
      continue;
    }
    if (item.unitDesi === null) {
      return null;
    }
    total = total.add(item.unitDesi.mul(item.quantity));
  }
  return { desi: total, source: 'PRODUCTS' };
}

/**
 * Resolves the VAT-exclusive (net) shipping tariff for a desi and basket. The desi
 * lookup key is `ceil(desi)` as an integer string. The Barem limit uses the
 * unrounded desi on purpose; only the tariff-table key is rounded up. The engine's pure
 * counterpart of `resolveTariffForDesi` (which only the products list's variant
 * estimator uses), without the database.
 */
export function resolveTrendyolShippingNet(params: {
  readonly desi: Decimal;
  readonly basketGross: Decimal;
  readonly eligibleForBarem: boolean;
  readonly tariff: TrendyolShippingTariff;
}): ShippingNetResult {
  const { desi, basketGross, eligibleForBarem, tariff } = params;
  const key = desi.ceil().toFixed(0);

  switch (tariff.source) {
    case ShippingTariffSource.OWN_CONTRACT: {
      const net = tariff.ownTariffNet.get(key);
      if (net === undefined) {
        return { ok: false, reason: 'OWN_CONTRACT_EMPTY' };
      }
      return { ok: true, net, kind: 'OWN' };
    }
    case ShippingTariffSource.TRENDYOL_CONTRACT: {
      const carrier = tariff.carrier;
      if (carrier === null) {
        return { ok: false, reason: 'NO_CARRIER' };
      }

      if (eligibleForBarem && carrier.supportsBarem && desi.lte(carrier.maxBaremDesi)) {
        const band = tariff.baremBands.find(
          (candidate) =>
            candidate.minOrderAmount.lte(basketGross) && basketGross.lte(candidate.maxOrderAmount),
        );
        if (band !== undefined) {
          return { ok: true, net: band.priceNet, kind: 'BAREM' };
        }
      }

      const net = tariff.desiTariffNet.get(key);
      if (net === undefined) {
        return { ok: false, reason: 'DESI_OVERFLOW' };
      }
      return { ok: true, net, kind: 'DESI' };
    }
    default: {
      const exhaustive: never = tariff.source;
      throw new Error(`Unhandled shipping tariff source: ${exhaustive}`);
    }
  }
}

/**
 * Resolves the VAT-inclusive (gross) shipping tariff: `resolveTrendyolShippingNet`
 * followed by `grossFromNet`. The single place where a shipping tariff becomes a
 * gross amount, shared by the parcel, standalone and return shipping estimates.
 */
export function resolveTrendyolShippingGross(params: {
  readonly desi: Decimal;
  readonly basketGross: Decimal;
  readonly eligibleForBarem: boolean;
  readonly tariff: TrendyolShippingTariff;
  readonly vatRatePct: Decimal;
}): ShippingGrossResult {
  const resolved = resolveTrendyolShippingNet({
    desi: params.desi,
    basketGross: params.basketGross,
    eligibleForBarem: params.eligibleForBarem,
    tariff: params.tariff,
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  return { ok: true, gross: grossFromNet(resolved.net, params.vatRatePct), kind: resolved.kind };
}

/** The carrier code recorded on the line: the carrier for Trendyol kinds, null for OWN. */
export function trendyolCarrierCodeForKind(
  kind: ShippingTariffKind,
  tariff: TrendyolShippingTariff,
): string | null {
  if (kind === 'OWN') {
    return null;
  }
  return tariff.carrier === null ? null : tariff.carrier.code;
}

/**
 * The standalone (as-if-shipped-alone) shipping gross for one item, used as an
 * allocation weight. The item desi is `unitDesi x quantity`, the basket is the
 * item's own sale, and the Barem eligibility is the parcel's. Returns `null` when
 * the desi is unknown or the tariff cannot be resolved.
 */
function standaloneShippingGross(params: {
  readonly item: ParcelItemSnapshot;
  readonly eligibleForBarem: boolean;
  readonly tariff: TrendyolShippingTariff;
  readonly shippingVatRatePct: Decimal;
}): Decimal | null {
  const { item, eligibleForBarem, tariff, shippingVatRatePct } = params;
  if (item.unitDesi === null) {
    return null;
  }

  const resolved = resolveTrendyolShippingGross({
    desi: item.unitDesi.mul(item.quantity),
    basketGross: item.saleGross,
    eligibleForBarem,
    tariff,
    vatRatePct: shippingVatRatePct,
  });
  if (!resolved.ok) {
    return null;
  }
  return resolved.gross;
}

/**
 * The single parcel-level SHIPPING estimate plus the per-item standalone amounts
 * that weight the allocation. The line is ESTIMATE / RULE at PARCEL level. An
 * unknown desi or an unresolvable tariff yields a blocking
 * SHIPPING_ESTIMATE_UNAVAILABLE issue (reason in `detail`) and no line; a zero gross
 * yields neither. A not-recognized carrier on a Trendyol-contract order yields a zero
 * line plus a non-blocking CARRIER_NOT_RECOGNIZED issue (provider name in `detail`).
 * A seller-cargo-agreement order on a Trendyol-contract store adds a non-blocking
 * SELLER_CARGO_AGREEMENT_ESTIMATE issue to whichever outcome it gets; its line is
 * unchanged. Digital items do not ship (plan decision 11b): an all-digital parcel
 * carries no shipping (no line, no issue) and every digital item's standalone amount
 * is zero.
 * The standalone amounts are always computed, even when the parcel line itself fails.
 */
export function estimateShippingLine(params: {
  readonly snapshot: ParcelSnapshot;
  readonly attributes: TrendyolParcelAttributes;
  readonly reference: TrendyolReferenceData;
}): {
  readonly line: ProfitLine | null;
  readonly issues: readonly ProfitIssue[];
  readonly standaloneByItem: ReadonlyMap<string, Decimal | null>;
} {
  const { snapshot, attributes, reference } = params;
  const items = activeItems(snapshot);

  if (items.length === 0) {
    return { line: null, issues: [], standaloneByItem: new Map() };
  }

  const eligibleForBarem = attributes.fastDelivery;
  const tariff = reference.shipping;
  const shippingVatRatePct = reference.fees.shippingVatRatePct;

  const standaloneByItem = new Map<string, Decimal | null>();
  for (const item of items) {
    standaloneByItem.set(
      item.orderItemId,
      item.isDigital
        ? ZERO
        : standaloneShippingGross({ item, eligibleForBarem, tariff, shippingVatRatePct }),
    );
  }

  // Digital items do not ship (plan decision 11b): an all-digital parcel carries no
  // shipping, exactly like the service-fee exemption.
  if (items.every((item) => item.isDigital)) {
    return { line: null, issues: [], standaloneByItem };
  }

  // A seller-cargo-agreement order on a Trendyol-contract store ships under the seller's
  // own carrier contract, whose real price the engine does not know. The line below is
  // still estimated from the Trendyol tariff, unchanged, but it never becomes an actual
  // (see map-records), so a non-blocking SELLER_CARGO_AGREEMENT_ESTIMATE issue records why
  // it stays an estimate (owner decision 2026-11-10). It rides along every outcome below,
  // after that outcome's own issue; an own-contract store is already priced from the
  // seller's own tariff and needs no warning.
  const sellerCargoIssues: readonly ProfitIssue[] =
    tariff.source === ShippingTariffSource.TRENDYOL_CONTRACT && attributes.usesSellerCargoAgreement
      ? [
          {
            code: ProfitIssueCode.SELLER_CARGO_AGREEMENT_ESTIMATE,
            orderItemId: null,
            detail: null,
          },
        ]
      : [];

  // A not-recognized carrier on a Trendyol-contract order cannot be priced from any
  // tariff, so the estimate is a zero SHIPPING line recording why -- never an unavailable
  // issue (a cargo invoice later replaces it with the real amount). A non-blocking
  // CARRIER_NOT_RECOGNIZED issue makes the zero visible on the statement; the return leg
  // adds none, so a parcel carries it once. This is distinct from a scenario with no
  // carrier, which stays NO_CARRIER / unavailable (its outcome is null); an own-contract
  // store is unaffected and falls through to its own tariff below.
  const carrierOutcome = tariff.orderCarrierOutcome;
  if (
    tariff.source === ShippingTariffSource.TRENDYOL_CONTRACT &&
    carrierOutcome !== null &&
    carrierOutcome.kind === 'not-recognized'
  ) {
    const line = createProfitLine({
      type: ProfitLineType.SHIPPING,
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
      certainty: ProfitLineCertainty.ESTIMATE,
      source: ProfitLineSource.RULE,
      amount: { gross: ZERO, vat: ZERO },
      vatRatePct: shippingVatRatePct,
      inputs: {
        reason: CARRIER_NOT_RECOGNIZED_REASON,
        providerName: carrierOutcome.providerName,
      },
      externalRecord: null,
    });
    return {
      line,
      issues: [
        {
          code: ProfitIssueCode.CARRIER_NOT_RECOGNIZED,
          orderItemId: null,
          detail: carrierOutcome.providerName,
        },
        ...sellerCargoIssues,
      ],
      standaloneByItem,
    };
  }

  const desi = parcelDesi(snapshot);
  if (desi === null) {
    return {
      line: null,
      issues: [
        {
          code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
          orderItemId: null,
          detail: 'UNKNOWN_DESI',
        },
        ...sellerCargoIssues,
      ],
      standaloneByItem,
    };
  }

  const basketGross = items.reduce((sum, item) => sum.add(item.saleGross), ZERO);
  const resolved = resolveTrendyolShippingGross({
    desi: desi.desi,
    basketGross,
    eligibleForBarem,
    tariff,
    vatRatePct: shippingVatRatePct,
  });
  if (!resolved.ok) {
    return {
      line: null,
      issues: [
        {
          code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
          orderItemId: null,
          detail: resolved.reason,
        },
        ...sellerCargoIssues,
      ],
      standaloneByItem,
    };
  }

  const gross = resolved.gross;
  if (gross.equals(ZERO)) {
    return { line: null, issues: sellerCargoIssues, standaloneByItem };
  }

  const amount: LineMoney = {
    gross,
    vat: vatFromGross(gross, shippingVatRatePct),
  };
  const line = createProfitLine({
    type: ProfitLineType.SHIPPING,
    level: ProfitLineLevel.PARCEL,
    orderItemId: null,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount,
    vatRatePct: shippingVatRatePct,
    inputs: {
      desi: desi.desi.toString(),
      desiSource: desi.source,
      basketGross: basketGross.toFixed(2),
      tariffKind: resolved.kind,
      carrierCode: trendyolCarrierCodeForKind(resolved.kind, tariff),
    },
    externalRecord: null,
  });

  return { line, issues: sellerCargoIssues, standaloneByItem };
}
