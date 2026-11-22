// A pure, hand-derivable TrendyolScenarioBase for the discount (and, in Faz 4B Task 8,
// campaign) unit tests. NOT production data: the real loader reads these from the database.
//
// The constants are chosen so every expected profit is hand-derivable:
//   - sale VAT 20, desi 1, physical;
//   - ONE COGS version 120 gross (VAT 20 -> 100 net);
//   - a FLAT desi tariff (every bracket 0..12 is 90.00 net -> 108 gross), so shipping is a
//     constant 90 net per parcel regardless of the basket quantity (the "one shipping per
//     parcel" claim stays exact as desi scales by n);
//   - the standard fixed PSF 10.99 net, 1% stoppage, commission/shipping/PSF VAT 20;
//   - settings include stopaj AND include negative net VAT, so the net profit is exactly the
//     sum of every line's net (gross minus its rounded VAT) minus stoppage, with no clamp.
//
// The base carries NO tariff bands, NO synced rate and a null commission override: each
// screen resolves its own commission (the three-tier chain) and hands it to the engine as the
// rate override. `overrides` tweak the price-relevant fields; keep it generic for Task 8.

import { Decimal } from 'decimal.js';
import { CostProfileType, ShippingTariffSource } from '@pazarsync/db/enums';
import type {
  ItemCostProfileInput,
  TrendyolReferenceData,
  TrendyolScenarioBase,
} from '@pazarsync/profit';
import type { ResolvedProfitSettings } from '@pazarsync/utils';

const SCENARIO_DATE = new Date('2026-10-29T09:00:00Z');

/** Include stopaj AND negative net VAT so net profit = sum of line nets minus stoppage. */
const SETTINGS: ResolvedProfitSettings = { includeStopaj: true, includeNegativeNetVat: true };

/** Every desi bracket 0..12 at 90.00 net -- shipping is a constant 90 net per parcel. */
function flatDesiTariff(): Map<string, Decimal> {
  const net = new Decimal('90.00');
  const map = new Map<string, Decimal>();
  for (let desi = 0; desi <= 12; desi += 1) {
    map.set(String(desi), net);
  }
  return map;
}

function reference(): TrendyolReferenceData {
  return {
    fees: {
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
          maxUnitSaleGross: new Decimal('99999999.99'),
          ratePct: new Decimal('35'),
        },
      ],
    },
    shipping: {
      // fastDelivery is false below, so Barem never applies and the desi tariff is used.
      source: ShippingTariffSource.TRENDYOL_CONTRACT,
      carrier: {
        code: 'TESTMP',
        supportsBarem: false,
        maxBaremDesi: new Decimal('0'),
        baremAppliesToReturns: false,
      },
      desiTariffNet: flatDesiTariff(),
      baremBands: [],
      ownTariffNet: new Map(),
      // A scenario base is a non-order context: the carrier field alone decides.
      orderCarrierOutcome: null,
      tariffVersionMissing: false,
    },
    commission: { categoryRatePct: new Map(), categoryBrandRatePct: new Map() },
  };
}

/** One COGS profile with a single version effective well before the scenario date. */
function cogs(amountGross: Decimal, vatRatePct: Decimal): ItemCostProfileInput[] {
  return [
    {
      profileId: 'cogs-discount-fixture',
      profileType: CostProfileType.COGS,
      versions: [
        {
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          versionNumber: 1,
          amountGross,
          vatRatePct,
          archivedAt: null,
        },
      ],
    },
  ];
}

/** Per-field overrides of the hand-derivable base (price-relevant fields only). */
export interface DiscountScenarioBaseOverrides {
  readonly saleVatRatePct?: Decimal;
  readonly unitDesi?: Decimal;
  readonly isDigital?: boolean;
  readonly cogsGross?: Decimal;
  readonly cogsVatRatePct?: Decimal;
  readonly settings?: ResolvedProfitSettings;
}

/**
 * Builds the hand-derivable scenario base (see the module header for the fixed constants).
 * The screen passes its own commission as the engine override, so the base has no bands, no
 * synced rate and a null override. `quantity` is one; the basket passes n to the engine.
 */
export function makeDiscountScenarioBase(
  overrides: DiscountScenarioBaseOverrides = {},
): TrendyolScenarioBase {
  return {
    product: {
      variantId: 'variant-discount-fixture',
      barcode: 'bc-discount-fixture',
      saleVatRatePct: overrides.saleVatRatePct ?? new Decimal('20'),
      unitDesi: overrides.unitDesi ?? new Decimal('1'),
      isDigital: overrides.isDigital ?? false,
      categoryId: null,
      brandId: null,
      syncedCommissionRatePct: null,
    },
    quantity: 1,
    commissionRatePctOverride: null,
    scenarioDate: SCENARIO_DATE,
    fastDelivery: false,
    isExportSale: false,
    reference: reference(),
    costs: cogs(
      overrides.cogsGross ?? new Decimal('120'),
      overrides.cogsVatRatePct ?? new Decimal('20'),
    ),
    settings: overrides.settings ?? SETTINGS,
  };
}
