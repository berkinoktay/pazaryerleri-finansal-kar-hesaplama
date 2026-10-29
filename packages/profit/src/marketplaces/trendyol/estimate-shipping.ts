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
import {
  createProfitLine,
  nativeFx,
  type LineMoney,
  type ProfitLine,
} from '../../core/profit-line';
import { grossFromNet, vatFromGross } from '../../tax/tr/vat';
import {
  type TrendyolParcelAttributes,
  type TrendyolReferenceData,
  type TrendyolShippingTariff,
} from './trendyol-inputs';

const ZERO = new Decimal(0);

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

/**
 * The parcel desi for a shipping estimate. The marketplace-measured desi wins when
 * present; otherwise the desi is the SUM of `unitDesi x quantity` over the active
 * items (the total, never the quantity-weighted average). The result is `null` when
 * any active item has an unknown desi or there is no active item to sum.
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
 * unrounded desi on purpose; only the tariff-table key is rounded up. Pure mirror of
 * the legacy `resolveTariffForDesi`, without the database.
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

/** The carrier code recorded on the line: the carrier for Trendyol kinds, null for OWN. */
function carrierCodeForKind(
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

  const resolved = resolveTrendyolShippingNet({
    desi: item.unitDesi.mul(item.quantity),
    basketGross: item.saleGross,
    eligibleForBarem,
    tariff,
  });
  if (!resolved.ok) {
    return null;
  }
  return grossFromNet(resolved.net, shippingVatRatePct);
}

/**
 * The single parcel-level SHIPPING estimate plus the per-item standalone amounts
 * that weight the allocation. The line is ESTIMATE / RULE at PARCEL level. An
 * unknown desi or an unresolvable tariff yields a blocking
 * SHIPPING_ESTIMATE_UNAVAILABLE issue (reason in `detail`) and no line; a zero gross
 * yields neither. The standalone amounts are always computed, even when the parcel
 * line itself fails.
 */
export function estimateShippingLine(params: {
  readonly snapshot: ParcelSnapshot;
  readonly attributes: TrendyolParcelAttributes;
  readonly reference: TrendyolReferenceData;
}): {
  readonly line: ProfitLine | null;
  readonly issue: ProfitIssue | null;
  readonly standaloneByItem: ReadonlyMap<string, Decimal | null>;
} {
  const { snapshot, attributes, reference } = params;
  const items = activeItems(snapshot);

  if (items.length === 0) {
    return { line: null, issue: null, standaloneByItem: new Map() };
  }

  const eligibleForBarem = attributes.fastDelivery;
  const tariff = reference.shipping;
  const shippingVatRatePct = reference.fees.shippingVatRatePct;

  const standaloneByItem = new Map<string, Decimal | null>();
  for (const item of items) {
    standaloneByItem.set(
      item.orderItemId,
      standaloneShippingGross({ item, eligibleForBarem, tariff, shippingVatRatePct }),
    );
  }

  const desi = parcelDesi(snapshot);
  if (desi === null) {
    return {
      line: null,
      issue: {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: 'UNKNOWN_DESI',
      },
      standaloneByItem,
    };
  }

  const basketGross = items.reduce((sum, item) => sum.add(item.saleGross), ZERO);
  const resolved = resolveTrendyolShippingNet({
    desi: desi.desi,
    basketGross,
    eligibleForBarem,
    tariff,
  });
  if (!resolved.ok) {
    return {
      line: null,
      issue: {
        code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
        orderItemId: null,
        detail: resolved.reason,
      },
      standaloneByItem,
    };
  }

  const gross = grossFromNet(resolved.net, shippingVatRatePct);
  if (gross.equals(ZERO)) {
    return { line: null, issue: null, standaloneByItem };
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
    fx: nativeFx(amount, snapshot.accountingCurrency),
    inputs: {
      desi: desi.desi.toString(),
      desiSource: desi.source,
      basketGross: basketGross.toFixed(2),
      tariffKind: resolved.kind,
      carrierCode: carrierCodeForKind(resolved.kind, tariff),
    },
    externalRecord: null,
  });

  return { line, issue: null, standaloneByItem };
}
