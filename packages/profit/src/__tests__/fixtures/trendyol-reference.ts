import { Decimal } from 'decimal.js';
import { ShippingTariffSource } from '@pazarsync/db/enums';

import {
  trendyolCategoryBrandKey,
  type TrendyolCommissionBand,
  type TrendyolCommissionRules,
  type TrendyolFeeParams,
  type TrendyolItemAttributes,
  type TrendyolParcelAttributes,
  type TrendyolReferenceData,
  type TrendyolShippingTariff,
} from '../../marketplaces/trendyol/trendyol-inputs';

/**
 * Test-only Trendyol reference data and attribute builders. This is NOT production
 * data: the Phase 3 loader reads the real values from the database. Money, rate and
 * desi fields are given as text and converted to `Decimal`, like the parcel builders.
 */

function defaultFees(): TrendyolFeeParams {
  return {
    psfStandardNet: new Decimal('10.99'),
    psfSameDayNet: new Decimal('6.99'),
    psfVatRatePct: new Decimal('20'),
    stoppageRatePct: new Decimal('1'),
    commissionVatRatePct: new Decimal('20'),
    shippingVatRatePct: new Decimal('20'),
    returnShippingVatRatePct: new Decimal('20'),
    internationalServiceRatePct: new Decimal('6'),
    internationalServiceVatRatePct: new Decimal('20'),
    overseasReturnTiers: [
      {
        minUnitSaleGross: new Decimal('0.00'),
        maxUnitSaleGross: new Decimal('2000.00'),
        ratePct: new Decimal('35'),
      },
      {
        minUnitSaleGross: new Decimal('2000.01'),
        maxUnitSaleGross: new Decimal('99999999.99'),
        ratePct: new Decimal('30'),
      },
    ],
  };
}

function defaultShipping(): TrendyolShippingTariff {
  return {
    source: ShippingTariffSource.TRENDYOL_CONTRACT,
    carrier: { code: 'TEXMP', supportsBarem: true, maxBaremDesi: new Decimal('10') },
    desiTariffNet: new Map([
      ['0', new Decimal('77.54')],
      ['1', new Decimal('77.54')],
      ['2', new Decimal('77.54')],
      ['3', new Decimal('93.63')],
      ['4', new Decimal('101.20')],
      ['5', new Decimal('108.90')],
      ['6', new Decimal('116.60')],
    ]),
    baremBands: [
      {
        minOrderAmount: new Decimal('0'),
        maxOrderAmount: new Decimal('199.99'),
        priceNet: new Decimal('34.16'),
      },
      {
        minOrderAmount: new Decimal('200'),
        maxOrderAmount: new Decimal('349.99'),
        priceNet: new Decimal('65.83'),
      },
    ],
    ownTariffNet: new Map(),
  };
}

function defaultCommission(): TrendyolCommissionRules {
  return {
    categoryRatePct: new Map([['369', new Decimal('20')]]),
    categoryBrandRatePct: new Map([
      [trendyolCategoryBrandKey('369', '977855'), new Decimal('16.5')],
    ]),
  };
}

/** Per-section shallow overrides of the reference data. */
export interface TrendyolReferenceOverrides {
  readonly fees?: Partial<TrendyolFeeParams>;
  readonly shipping?: Partial<TrendyolShippingTariff>;
  readonly commission?: Partial<TrendyolCommissionRules>;
}

/**
 * Builds a complete Trendyol reference data set with the fixture defaults, shallow
 * merging the overrides per section.
 */
export function trendyolReference(
  overrides: TrendyolReferenceOverrides = {},
): TrendyolReferenceData {
  return {
    fees: { ...defaultFees(), ...overrides.fees },
    shipping: { ...defaultShipping(), ...overrides.shipping },
    commission: { ...defaultCommission(), ...overrides.commission },
  };
}

/**
 * The audit scenario reference (not production data): carries the assumptions of the
 * profit-engine audit report. The ARASMP carrier supports Barem up to 10 desi, the
 * Barem bands are 42.91 ([0, 199.99]) and 73.74 ([200, 349.99]), desi '2' is 83.93,
 * there is no own tariff, and the only commission rule is category '369' at 20%.
 * The default fees (PSF, VAT and stoppage rates) are kept.
 */
export function arasmpScenarioReference(): TrendyolReferenceData {
  return trendyolReference({
    shipping: {
      source: ShippingTariffSource.TRENDYOL_CONTRACT,
      carrier: { code: 'ARASMP', supportsBarem: true, maxBaremDesi: new Decimal('10') },
      desiTariffNet: new Map([['2', new Decimal('83.93')]]),
      baremBands: [
        {
          minOrderAmount: new Decimal('0'),
          maxOrderAmount: new Decimal('199.99'),
          priceNet: new Decimal('42.91'),
        },
        {
          minOrderAmount: new Decimal('200'),
          maxOrderAmount: new Decimal('349.99'),
          priceNet: new Decimal('73.74'),
        },
      ],
      ownTariffNet: new Map(),
    },
    commission: {
      categoryRatePct: new Map([['369', new Decimal('20')]]),
      categoryBrandRatePct: new Map(),
    },
  });
}

/** A tariff band given as text, mirroring the stored string shape. */
export interface MakeTrendyolBandParams {
  readonly lowerLimit: string | null;
  readonly upperLimit: string | null;
  readonly ratePct: string;
}

function toBand(band: MakeTrendyolBandParams): TrendyolCommissionBand {
  return {
    lowerLimit: band.lowerLimit === null ? null : new Decimal(band.lowerLimit),
    upperLimit: band.upperLimit === null ? null : new Decimal(band.upperLimit),
    ratePct: new Decimal(band.ratePct),
  };
}

/**
 * Commission attributes for one order item. `orderItemId` is required. Rates are
 * given as text; `null` is kept as an explicit value, so the default only applies
 * when the field is omitted.
 */
export interface MakeTrendyolItemAttributesParams {
  readonly orderItemId: string;
  readonly orderCommissionRatePct?: string | null;
  readonly tariffBands?: readonly MakeTrendyolBandParams[] | null;
  readonly syncedCommissionRatePct?: string | null;
  readonly categoryId?: string | null;
  readonly brandId?: string | null;
}

export function makeTrendyolItemAttributes(
  params: MakeTrendyolItemAttributesParams,
): TrendyolItemAttributes {
  const orderText =
    params.orderCommissionRatePct === undefined ? '19' : params.orderCommissionRatePct;
  const syncedText =
    params.syncedCommissionRatePct === undefined ? null : params.syncedCommissionRatePct;
  const tariffBands =
    params.tariffBands === undefined || params.tariffBands === null
      ? null
      : params.tariffBands.map(toBand);
  return {
    orderItemId: params.orderItemId,
    orderCommissionRatePct: orderText === null ? null : new Decimal(orderText),
    tariffBands,
    syncedCommissionRatePct: syncedText === null ? null : new Decimal(syncedText),
    categoryId: params.categoryId === undefined ? '369' : params.categoryId,
    brandId: params.brandId === undefined ? null : params.brandId,
  };
}

/** Parcel-level Trendyol attributes. All fields default; `items` defaults to empty. */
export interface MakeTrendyolAttributesParams {
  readonly fastDelivery?: boolean;
  readonly fastDeliveryType?: string | null;
  readonly actualShipDate?: Date | null;
  readonly usesSellerCargoAgreement?: boolean;
  readonly items?: readonly TrendyolItemAttributes[];
}

export function makeTrendyolAttributes(
  params: MakeTrendyolAttributesParams = {},
): TrendyolParcelAttributes {
  return {
    fastDelivery: params.fastDelivery ?? false,
    fastDeliveryType: params.fastDeliveryType === undefined ? null : params.fastDeliveryType,
    actualShipDate: params.actualShipDate === undefined ? null : params.actualShipDate,
    usesSellerCargoAgreement: params.usesSellerCargoAgreement ?? false,
    items: params.items ?? [],
  };
}
