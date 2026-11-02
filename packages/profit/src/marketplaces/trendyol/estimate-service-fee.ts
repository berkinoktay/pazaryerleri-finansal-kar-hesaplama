import { Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
} from '@pazarsync/db/enums';

import { activeItems, type ParcelSnapshot } from '../../core/parcel-snapshot';
import { createProfitLine, type LineMoney, type ProfitLine } from '../../core/profit-line';
import { inferShippedSameDay } from '../../infer-shipped-same-day';
import { grossFromNet, vatFromGross } from '../../tax/tr/vat';
import {
  TRENDYOL_SAME_DAY_SHIPPING_TYPE,
  type TrendyolFeeParams,
  type TrendyolParcelAttributes,
} from './trendyol-inputs';

const ZERO = new Decimal(0);

/** The platform-service-fee tier, recorded on the line inputs. */
const SERVICE_FEE_TIER = {
  STANDARD: 'STANDARD',
  SAME_DAY: 'SAME_DAY',
} as const;

type ServiceFeeTier = (typeof SERVICE_FEE_TIER)[keyof typeof SERVICE_FEE_TIER];

/**
 * The Trendyol platform service fee (PSF) estimate for one parcel. The fee is a
 * flat per-parcel amount, so the line is PARCEL level. It is never charged for an
 * export parcel, a parcel with no active items, or a parcel whose every active item
 * is digital (plan Gorev 6; same exemptions as the legacy `isPsfExempt`).
 *
 * The same-day tier (`psfSameDayNet`) applies only when the parcel is marked
 * same-day shipping and the ship is not known to have slipped to a later Istanbul
 * day: `fastDeliveryType === TRENDYOL_SAME_DAY_SHIPPING_TYPE` and
 * `inferShippedSameDay(...) !== false` (an unknown ship date stays optimistic).
 * Otherwise the standard tier (`psfStandardNet`) applies. A zero gross writes no
 * line. Lines are ESTIMATE / RULE in Turkish lira.
 */
export function estimateServiceFeeLine(params: {
  readonly snapshot: ParcelSnapshot;
  readonly attributes: TrendyolParcelAttributes;
  readonly fees: TrendyolFeeParams;
}): ProfitLine | null {
  const { snapshot, attributes, fees } = params;

  if (snapshot.isExportSale) {
    return null;
  }

  const active = activeItems(snapshot);
  if (active.length === 0) {
    return null;
  }
  if (active.every((item) => item.isDigital)) {
    return null;
  }

  const isSameDay =
    attributes.fastDeliveryType === TRENDYOL_SAME_DAY_SHIPPING_TYPE &&
    inferShippedSameDay({
      orderDate: snapshot.orderDate,
      actualShipDate: attributes.actualShipDate,
    }) !== false;

  const tier: ServiceFeeTier = isSameDay ? SERVICE_FEE_TIER.SAME_DAY : SERVICE_FEE_TIER.STANDARD;
  const net = isSameDay ? fees.psfSameDayNet : fees.psfStandardNet;

  const gross = grossFromNet(net, fees.psfVatRatePct);
  if (gross.equals(ZERO)) {
    return null;
  }

  const amount: LineMoney = {
    gross,
    vat: vatFromGross(gross, fees.psfVatRatePct),
  };

  return createProfitLine({
    type: ProfitLineType.SERVICE_FEE,
    level: ProfitLineLevel.PARCEL,
    orderItemId: null,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount,
    vatRatePct: fees.psfVatRatePct,
    inputs: {
      tier,
      net: net.toFixed(2),
    },
    externalRecord: null,
  });
}
