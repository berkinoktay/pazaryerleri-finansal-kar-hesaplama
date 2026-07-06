import type {
  AdvantageCommissionSource,
  AdvantageTariffDetail,
  AdvantageTariffDetailItem,
  CommissionSourceMode,
  StarTierKey,
} from '../api/get-advantage-tariff-detail.api';

/** One of the three concrete star tiers (never null) — an actual seller choice. */
export type NonNullStarTierKey = NonNullable<StarTierKey>;

/**
 * One Advantage star tier rendered as a band-like option so the detail screen can share
 * the commission/Plus winner resolver ({@link resolveBestChoice}) and card cells: the
 * tier's target price + reduced commission with the backend-computed net profit / margin.
 * `key` is the star tier (`tier1`..`tier3`); `commissionPct`/`netProfit`/`marginPct` are
 * null when the row is not calculable.
 */
export interface AdvantageBand {
  key: NonNullStarTierKey;
  /** The tier's target price (the amount the buyer sees at this tier). */
  price: string;
  commissionPct: string | null;
  netProfit: string | null;
  marginPct: string | null;
}

/**
 * An Advantage tariff product row as the detail table consumes it. Mirrors the commission
 * `CommissionTariffRow` / Plus `PlusTariffRow` shape so the shared cells work: the flat
 * CURRENT figures (lifted out of the nested `current` scenario) plus every star tier
 * folded into a `bands` array (0–3 elements). Money is a GROSS decimal STRING and
 * `commissionPct` a PERCENT string — the frontend renders, never computes. Uncalculable
 * rows carry `null` profit/margin.
 */
export interface AdvantageTariffRow {
  id: string;
  barcode: string;
  stockCode: string | null;
  productTitle: string;
  imageUrl: string | null;
  category: string | null;
  brand: string | null;
  size: string | null;
  stock: number | null;
  /** The seller's list price. */
  currentPrice: string;
  /** The price the buyer sees — the current net profit is computed from this. */
  customerPrice: string;
  hasCommissionTariff: boolean;
  currentCommissionPct: string | null;
  currentNetProfit: string | null;
  currentMarginPct: string | null;
  calculable: boolean;
  reason: AdvantageTariffDetailItem['reason'];
  /** Server-authoritative chosen tier (seeds the edit buffer); null when none / custom. */
  selectedTier: StarTierKey;
  /** Server-authoritative committed custom price, or null when tier-joined / not joined. */
  customPrice: string | null;
  /** The row's star tiers as band-like candidates (`bands.length` is 0–3). */
  bands: readonly AdvantageBand[];
}

/**
 * A saved Advantage tariff as the detail screen consumes it. Unlike the commission/Plus
 * verticals there are NO periods and NO validity — an Advantage file carries no dates —
 * so the product rows are held directly. `exported` + the commission-source meta are
 * server-authoritative.
 */
export interface AdvantageTariffView {
  id: string;
  name: string;
  exported: boolean;
  /** How the reduced commission is sourced: pinned tariff (override) / category rate. */
  commissionSourceMode: CommissionSourceMode;
  /** Which commission tariff/period supplies the rates, or null when none applies. */
  commissionSource: AdvantageCommissionSource;
  /** True when a H="Var" product failed to match the active commission tariff (drives the C hybrid warning). */
  hasUnmatchedCommissionProducts: boolean;
  rows: readonly AdvantageTariffRow[];
}

/** Fold an Advantage detail item into the table row shape (star tiers → `bands`). */
function toRow(item: AdvantageTariffDetailItem): AdvantageTariffRow {
  return {
    id: item.id,
    barcode: item.barcode,
    stockCode: item.stockCode,
    productTitle: item.productTitle,
    imageUrl: item.imageUrl,
    category: item.category,
    brand: item.brand,
    size: item.size,
    stock: item.stock,
    currentPrice: item.currentPrice,
    customerPrice: item.customerPrice,
    hasCommissionTariff: item.hasCommissionTariff,
    // Lift the nested current scenario to the flat figures the shared cells + the winner
    // resolver read.
    currentCommissionPct: item.current.commissionPct,
    currentNetProfit: item.current.netProfit,
    currentMarginPct: item.current.marginPct,
    calculable: item.calculable,
    reason: item.reason,
    selectedTier: item.selectedTier,
    customPrice: item.customPrice,
    // flatMap drops any tier with a null key (never happens for a real tier) and narrows
    // `tier.key` to a concrete star key inside the guard.
    bands: item.tiers.flatMap((tier) =>
      tier.key !== null
        ? [
            {
              key: tier.key,
              price: tier.price,
              commissionPct: tier.commissionPct,
              netProfit: tier.netProfit,
              marginPct: tier.marginPct,
            },
          ]
        : [],
    ),
  };
}

/**
 * Maps the backend `AdvantageTariffDetail` to the detail screen's `AdvantageTariffView`:
 * renames `items` → `rows`, lifts the commission-source meta, and folds every item's star
 * tiers into band-like candidates + flat current figures so a row reads like a commission
 * row. No money math — the engine already computed every scenario's profit/margin.
 */
export function toAdvantageTariffView(detail: AdvantageTariffDetail): AdvantageTariffView {
  return {
    id: detail.id,
    name: detail.name,
    exported: detail.exported,
    commissionSourceMode: detail.commissionSourceMode,
    commissionSource: detail.commissionSource,
    hasUnmatchedCommissionProducts: detail.hasUnmatchedCommissionProducts,
    rows: detail.items.map(toRow),
  };
}
