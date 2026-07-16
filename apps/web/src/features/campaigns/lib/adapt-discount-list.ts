import type {
  DiscountCommissionBand,
  DiscountCommissionSource,
  DiscountItemReason,
  DiscountListDetail,
  DiscountListDetailItem,
  DiscountListSummary,
} from '../api/get-discount-list-detail.api';

export type { DiscountCommissionBand };

/**
 * Component-facing shapes for the İndirimler (Discounts) DETAIL screen. Money is a GROSS decimal
 * STRING and `commissionPct` a PERCENT string, exactly as the backend serializes — the frontend
 * renders, never computes (the profit engine already computed each scenario's profit/margin on
 * read). Uncalculable rows carry `null` profit/margin + a `reason`, so every consumer must
 * null-guard. Unlike the Flash detail there is NO band folding: each item exposes exactly two
 * fixed price SCENARIOS — the CURRENT price and the DISCOUNTED price — so the row is a flat
 * one-to-one projection of the backend item.
 */

/** One price scenario of a discount row (current price or discounted price). */
export interface DiscountScenario {
  price: string;
  commissionPct: string | null;
  commissionSource: DiscountCommissionSource;
  netProfit: string | null;
  marginPct: string | null;
}

/**
 * A Discounts product ROW as the detail table consumes it — one product, two price scenarios.
 * Mirrors the backend `DiscountListDetailItem` field-for-field; `included` is the seller's
 * server-authoritative participation flag.
 */
export interface DiscountRow {
  id: string;
  barcode: string;
  /** Trendyol "Model Kodu" — the row's stock-code equivalent (identity meta + search). */
  modelCode: string | null;
  /** Trendyol content/listing id, when the file carried one. */
  externalId: string | null;
  productTitle: string;
  brand: string | null;
  color: string | null;
  imageUrl: string | null;
  included: boolean;
  calculable: boolean;
  reason: DiscountItemReason;
  /** The seller's current price scenario at its resolved commission. */
  current: DiscountScenario;
  /** The discounted price scenario (commission RE-resolved on the lower price). */
  discounted: DiscountScenario;
  /**
   * The item's commission-band ladder (top-down); null when no tariff week resolved bands
   * for the barcode. Feeds the commission cell's bands popover (which band each price lands in).
   */
  commissionBands: readonly DiscountCommissionBand[] | null;
}

/**
 * A saved discount list as the detail screen consumes it. Carries the backend summary card
 * verbatim (item / included counts, per-order cost, max total cost, average profit delta) plus
 * the projected rows. `exported` is server-authoritative.
 */
export interface DiscountListView {
  id: string;
  name: string;
  exported: boolean;
  /** Name of the commission tariff feeding the bands (null when no covering week resolved). */
  commissionTariffName: string | null;
  /** Period label of that tariff week (e.g. "7 - 14 Temmuz"); null when unresolved. */
  commissionPeriodLabel: string | null;
  summary: DiscountListSummary;
  rows: readonly DiscountRow[];
}

/** Flat projection of one backend detail item into the table row shape (identity mapping). */
function toRow(item: DiscountListDetailItem): DiscountRow {
  return {
    id: item.id,
    barcode: item.barcode,
    modelCode: item.modelCode,
    externalId: item.externalId,
    productTitle: item.productTitle,
    brand: item.brand,
    color: item.color,
    imageUrl: item.imageUrl,
    included: item.included,
    calculable: item.calculable,
    reason: item.reason,
    current: item.current,
    discounted: item.discounted,
    commissionBands: item.commissionBands,
  };
}

/**
 * Maps the backend `DiscountListDetail` to the detail screen's `DiscountListView`: renames
 * `items` → `rows` and passes the summary through untouched. No money math — the engine already
 * computed every scenario's profit/margin.
 */
export function toDiscountListView(detail: DiscountListDetail): DiscountListView {
  return {
    id: detail.id,
    name: detail.name,
    exported: detail.exported,
    commissionTariffName: detail.commissionTariffName,
    commissionPeriodLabel: detail.commissionPeriodLabel,
    summary: detail.summary,
    rows: detail.items.map(toRow),
  };
}
