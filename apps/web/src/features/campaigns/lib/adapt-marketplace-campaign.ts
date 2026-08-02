import type {
  CampaignBasketScenario,
  CampaignCommissionBand,
  CampaignDiscountType,
  CampaignItemReason,
  CampaignPriceSelection,
  CampaignScenario,
  CampaignScenarioPresentation,
  CampaignValueKind,
  MarketplaceCampaignDetail,
  MarketplaceCampaignDetailItem,
} from '../api/get-marketplace-campaign-detail.api';

export type {
  CampaignBasketScenario,
  CampaignCommissionBand,
  CampaignScenario,
  CampaignScenarioPresentation,
};

/**
 * Component-facing shapes for the Kampanyalar (Marketplace Campaigns) DETAIL screen. Money is
 * a GROSS decimal STRING and `commissionPct` a PERCENT string, exactly as the backend
 * serializes — the frontend renders, never computes (the profit engine already computed each
 * scenario's profit/margin on read). Uncalculable rows carry `null` profit/margin on every
 * scenario plus a `reason`, so every consumer must null-guard.
 *
 * Unlike the İndirimler detail (two fixed scenarios) or the Flaş Ürünler detail (0–2 folded
 * offer bands), a campaign item carries exactly THREE scenarios that are NOT interchangeable:
 * `current` (campaign-free, always present), `maxScenario` (the maximum price Trendyol
 * allows, always present), and `customScenario` (the seller's own saved price — null when the
 * seller has typed no custom price yet). `customScenario` staying null is a normal, common
 * state, not a missing-data error; nothing here backfills it with `maxScenario` or any other
 * derived value.
 */

/**
 * A Marketplace Campaigns product ROW as the detail table consumes it — one product, three
 * price scenarios. Flat one-to-one projection of the backend `MarketplaceCampaignDetailItem`;
 * `selection` and `customPrice` are server-authoritative and seed the row's edit buffer.
 */
export interface MarketplaceCampaignRow {
  id: string;
  barcode: string;
  /** Trendyol "Model Kodu" — the row's stock-code equivalent (identity meta + search). */
  productCode: string | null;
  /** Trendyol content/listing id, when the file carried one. */
  externalId: string | null;
  productTitle: string;
  brand: string | null;
  color: string | null;
  size: string | null;
  category: string | null;
  stock: number | null;
  imageUrl: string | null;
  /** The seller's current (campaign-free) price. */
  currentPrice: string;
  /** "Maksimum Girebileceğin Fiyat" — the ceiling Trendyol allows for this item. */
  maxPrice: string;
  hasCommissionTariff: boolean;
  /** Server-authoritative price choice: NONE (not participating) / MAX / CUSTOM. */
  selection: CampaignPriceSelection;
  /** Server-authoritative saved custom price; independent of `selection` (see api docstring). */
  customPrice: string | null;
  calculable: boolean;
  reason: CampaignItemReason;
  /** Campaign-free scenario at the item's current price. Always present. */
  current: CampaignScenario;
  /** Scenario at the maximum price Trendyol allows. Always present. */
  maxScenario: CampaignScenario;
  /**
   * Scenario at the seller's own saved custom price. NULL when no custom price is saved —
   * this is a normal state (most rows start here), never backfilled with another scenario.
   */
  customScenario: CampaignScenario | null;
  /**
   * The item's commission-band ladder (top-down); null when no tariff week resolved bands
   * for the barcode. Feeds the commission cell's bands popover (which band each price lands in).
   */
  commissionBands: readonly CampaignCommissionBand[] | null;
  /**
   * Single-product-basket settlement scenario for basket-scoped discount types, framed on the
   * item's SAVED price choice; null for NET or a non-positive price.
   */
  scenario: CampaignBasketScenario | null;
}

/**
 * The campaign-level configuration + metadata as the detail screen's header consumes it — the
 * full `MarketplaceCampaignDetail` response minus its `items` array. Carries every discount-
 * kurgu parameter (only the ones relevant to `discountType` are ever non-null), the Trendyol
 * funding rate, the campaign window, and the commission-tariff transparency labels.
 */
export interface MarketplaceCampaignHeader {
  id: string;
  name: string;
  discountType: CampaignDiscountType;
  valueKind: CampaignValueKind;
  value: string | null;
  minBasketAmount: string | null;
  minQuantity: number | null;
  buyQuantity: number | null;
  payQuantity: number | null;
  nthIndex: number | null;
  /** Trendyol karşılama oranı (%), 0–100. */
  trendyolFundingPct: string;
  startsAt: string | null;
  endsAt: string | null;
  exported: boolean;
  /** Name of the commission tariff feeding the bands (null when no covering week resolved). */
  commissionTariffName: string | null;
  /** Period label of that tariff week (e.g. "7 - 14 Temmuz"); null when unresolved. */
  commissionPeriodLabel: string | null;
  commissionTariffOutdated: boolean;
  /**
   * Which row layout the config calls for: `UNIT` (the unit price genuinely drops, show the
   * scenario's own unit price) or `ORDER` (the effective unit is a synthetic average, so show
   * the whole assumed-basket order). Decided by the backend — the row just renders the chosen
   * layout.
   */
  scenarioPresentation: CampaignScenarioPresentation;
}

/** Flat projection of one backend detail item into the table row shape (identity mapping). */
function toRow(item: MarketplaceCampaignDetailItem): MarketplaceCampaignRow {
  return {
    id: item.id,
    barcode: item.barcode,
    productCode: item.productCode,
    externalId: item.externalId,
    productTitle: item.productTitle,
    brand: item.brand,
    color: item.color,
    size: item.size,
    category: item.category,
    stock: item.stock,
    imageUrl: item.imageUrl,
    currentPrice: item.currentPrice,
    maxPrice: item.maxPrice,
    hasCommissionTariff: item.hasCommissionTariff,
    selection: item.selection,
    customPrice: item.customPrice,
    calculable: item.calculable,
    reason: item.reason,
    current: item.current,
    maxScenario: item.maxScenario,
    customScenario: item.customScenario,
    commissionBands: item.commissionBands,
    scenario: item.scenario,
  };
}

/** Projects the backend `MarketplaceCampaignDetail`'s top-level fields (everything but `items`). */
function toHeader(detail: MarketplaceCampaignDetail): MarketplaceCampaignHeader {
  return {
    id: detail.id,
    name: detail.name,
    discountType: detail.discountType,
    valueKind: detail.valueKind,
    value: detail.value,
    minBasketAmount: detail.minBasketAmount,
    minQuantity: detail.minQuantity,
    buyQuantity: detail.buyQuantity,
    payQuantity: detail.payQuantity,
    nthIndex: detail.nthIndex,
    trendyolFundingPct: detail.trendyolFundingPct,
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    exported: detail.exported,
    commissionTariffName: detail.commissionTariffName,
    commissionPeriodLabel: detail.commissionPeriodLabel,
    commissionTariffOutdated: detail.commissionTariffOutdated,
    scenarioPresentation: detail.scenarioPresentation,
  };
}

/**
 * Maps the backend `MarketplaceCampaignDetail` to the detail screen's table-ready shape:
 * campaign-level config/metadata split into `header`, items projected into `rows`. No money
 * math anywhere — the profit engine already computed every scenario's profit/margin, and the
 * per-unit funded-split fields (`customerPaidUnitPrice`/`trendyolFundedUnitAmount` on the
 * estimate result) are a separate, deliberately-nullable concern this adapter does not touch.
 */
export function adaptMarketplaceCampaignDetail(detail: MarketplaceCampaignDetail): {
  header: MarketplaceCampaignHeader;
  rows: MarketplaceCampaignRow[];
} {
  return {
    header: toHeader(detail),
    rows: detail.items.map(toRow),
  };
}
