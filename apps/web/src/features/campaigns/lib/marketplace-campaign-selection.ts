import { Decimal } from 'decimal.js';

import type { EstimateCampaignItemResult } from '../api/estimate-campaign-item.api';
import type { TargetMarginResult } from '../api/suggest-target-margin.api';
import type { UpdateCampaignSelectionsBody } from '../api/update-campaign-selections.api';
import type {
  CampaignBasketScenario,
  CampaignScenario,
  CampaignScenarioPresentation,
  MarketplaceCampaignRow,
} from './adapt-marketplace-campaign';
import { compareFixedDecimal } from './best-choice';

/**
 * The Kampanyalar detail's LOCAL edit buffer. Nothing here touches the network: the seller's
 * price choices live in this buffer until "Kaydet ve İndir" writes the whole set with one
 * selections request (design §6). The backend stores a row's custom price INDEPENDENTLY of its
 * choice — a seller may type a price to compare yet stay on the maximum — and the buffer mirrors
 * that: `selection` says which option the row joins with, `customPrices` holds the typed price.
 * Every comparison below is ordering or validation over backend-served figures; no profit,
 * commission or price is computed here.
 */

/** The price option a row joins the campaign with. */
export type CampaignPriceChoice = 'MAX' | 'CUSTOM';

/** rowId → the chosen option; null (or absent) = the row does not participate. */
export type CampaignSelectionMap = Record<string, CampaignPriceChoice | null>;

/** rowId → the typed custom price as a 2-decimal string; null = no price typed. */
export type CampaignCustomPriceMap = Record<string, string | null>;

export interface CampaignChoiceState {
  selection: CampaignSelectionMap;
  customPrices: CampaignCustomPriceMap;
}

/** The custom-price ceiling: "Maksimum Girebileceğin Fiyat", which already carries Trendyol's price rule. */
export function campaignCustomCeiling(row: Pick<MarketplaceCampaignRow, 'maxPrice'>): Decimal {
  return new Decimal(row.maxPrice);
}

/**
 * Whether a typed custom price can join the campaign: `valid` only when it is above zero and
 * within the ceiling. The backend refuses the other two non-empty states, so the card flags them
 * inline and never sends them.
 */
export type CustomPriceStatus = 'empty' | 'valid' | 'notPositive' | 'aboveMax';

export function customPriceStatus(
  price: string | null,
  row: Pick<MarketplaceCampaignRow, 'maxPrice'>,
): CustomPriceStatus {
  if (price === null) return 'empty';
  const value = new Decimal(price);
  if (!value.greaterThan(0)) return 'notPositive';
  if (value.greaterThan(campaignCustomCeiling(row))) return 'aboveMax';
  return 'valid';
}

/**
 * Seeds the buffer from every row's server-authoritative choice and saved custom price. A saved
 * CUSTOM choice whose price could not be exported (none, or above the ceiling) seeds as no choice,
 * so the buffer never starts in a state the save would refuse.
 */
export function seedCampaignChoices(rows: readonly MarketplaceCampaignRow[]): CampaignChoiceState {
  const selection: CampaignSelectionMap = {};
  const customPrices: CampaignCustomPriceMap = {};
  for (const row of rows) {
    customPrices[row.id] = row.customPrice;
    const unusableCustom =
      row.selection === 'CUSTOM' && customPriceStatus(row.customPrice, row) !== 'valid';
    selection[row.id] = row.selection === 'NONE' || unusableCustom ? null : row.selection;
  }
  return { selection, customPrices };
}

/**
 * Puts a typed custom price into the buffer. A row that joined with its custom price keeps that
 * choice while the price stays valid; once the price is cleared or leaves the allowed range the
 * row stops participating instead of carrying a price the save would refuse.
 */
export function applyCustomPrice(
  state: CampaignChoiceState,
  row: MarketplaceCampaignRow,
  price: string | null,
): CampaignChoiceState {
  const customPrices = { ...state.customPrices, [row.id]: price };
  const keepsChoice =
    state.selection[row.id] !== 'CUSTOM' || customPriceStatus(price, row) === 'valid';
  return {
    customPrices,
    selection: keepsChoice ? state.selection : { ...state.selection, [row.id]: null },
  };
}

/**
 * Toggles one option for a row: choosing the active option again clears it (the row leaves the
 * campaign), choosing the other one switches. CUSTOM is refused while the buffered price is not
 * valid — the card's select control is disabled in exactly that state.
 */
export function toggleCampaignChoice(
  state: CampaignChoiceState,
  row: MarketplaceCampaignRow,
  choice: CampaignPriceChoice,
): CampaignChoiceState {
  const active = state.selection[row.id] ?? null;
  if (active === choice) {
    return { ...state, selection: { ...state.selection, [row.id]: null } };
  }
  if (
    choice === 'CUSTOM' &&
    customPriceStatus(state.customPrices[row.id] ?? null, row) !== 'valid'
  ) {
    return state;
  }
  return { ...state, selection: { ...state.selection, [row.id]: choice } };
}

/**
 * How many rows join the campaign, per price option — the summary strip's counts, and their sum
 * gates "Kaydet ve İndir" (an empty export is refused).
 */
export function countCampaignChoices(
  rows: readonly MarketplaceCampaignRow[],
  state: CampaignChoiceState,
): { max: number; custom: number } {
  let max = 0;
  let custom = 0;
  for (const row of rows) {
    const choice = state.selection[row.id] ?? null;
    if (choice === 'MAX') max += 1;
    else if (choice === 'CUSTOM') custom += 1;
  }
  return { max, custom };
}

/**
 * The whole-campaign payload for "Kaydet ve İndir" (`mode: 'set'` over every row, so the saved
 * state mirrors the buffer exactly). A custom price the backend would refuse — zero or above the
 * ceiling — travels as null: it is a draft the card already flags, never a saved choice. CUSTOM
 * never travels without its price.
 */
export function toCampaignSelectionsPayload(
  rows: readonly MarketplaceCampaignRow[],
  state: CampaignChoiceState,
): UpdateCampaignSelectionsBody['selections'] {
  return rows.map((row) => {
    const typed = state.customPrices[row.id] ?? null;
    const customPrice = customPriceStatus(typed, row) === 'valid' ? typed : null;
    const choice = state.selection[row.id] ?? null;
    const selection =
      choice === null || (choice === 'CUSTOM' && customPrice === null) ? 'NONE' : choice;
    return { itemId: row.id, selection, customPrice };
  });
}

// ─── What a price card headlines ──────────────────────────────────────────────

/**
 * The figures one price card shows: its profit, the margin that tints the badge, the baseline
 * the "vs" delta compares against and — on an ORDER-framed card — the assumed order it describes.
 */
export interface CampaignOptionFigures {
  netProfit: string | null;
  marginPct: string | null;
  /** The "do nothing" profit on the SAME basis: the current unit profit, or the same order campaign-free. */
  baselineNetProfit: string | null;
  /** The assumed single-product order behind an ORDER-framed figure; null for a per-unit figure. */
  order: { quantity: number; paidTotal: string } | null;
}

/**
 * The figures of a price option from its unit scenario and its basket block. An ORDER row
 * headlines the basket — every price card shows its own order (Berkin's decision, 2026-10-22) —
 * and falls back to the unit scenario only where there is no basket (a non-positive price).
 */
export function campaignOptionFigures(
  presentation: CampaignScenarioPresentation,
  scenario: CampaignScenario,
  basket: CampaignBasketScenario | null,
  current: CampaignScenario,
): CampaignOptionFigures {
  if (presentation === 'ORDER' && basket !== null) {
    return {
      netProfit: basket.orderNetProfit,
      marginPct: basket.orderMarginPct,
      baselineNetProfit: basket.currentOrderNetProfit,
      order: { quantity: basket.assumedQuantity, paidTotal: basket.basketPaidTotal },
    };
  }
  return {
    netProfit: scenario.netProfit,
    marginPct: scenario.marginPct,
    baselineNetProfit: current.netProfit,
    order: null,
  };
}

/**
 * The same figures from a live what-if estimate: an order-scoped result headlines its basket
 * (the block the saved card would show for that price), a unit-scoped one its own breakdown
 * against the row's current unit profit.
 */
export function estimateOptionFigures(
  result: EstimateCampaignItemResult,
  current: CampaignScenario,
): CampaignOptionFigures {
  if (result.breakdownScope === 'order' && result.basket !== null) {
    return {
      netProfit: result.basket.orderNetProfit,
      marginPct: result.basket.orderMarginPct,
      baselineNetProfit: result.basket.currentOrderNetProfit,
      order: { quantity: result.basket.assumedQuantity, paidTotal: result.basket.basketPaidTotal },
    };
  }
  return {
    netProfit: result.breakdown?.netProfit ?? null,
    marginPct: result.breakdown?.saleMarginPct ?? null,
    baselineNetProfit: current.netProfit,
    order: null,
  };
}

/**
 * The custom card's SAVED figures — only while the buffer still holds the saved custom price; a
 * different typed price has no figures until its live estimate lands.
 */
export function savedCustomFigures(
  row: MarketplaceCampaignRow,
  presentation: CampaignScenarioPresentation,
  bufferedPrice: string | null,
): CampaignOptionFigures | null {
  if (row.customScenario === null || bufferedPrice === null || bufferedPrice !== row.customPrice) {
    return null;
  }
  return campaignOptionFigures(presentation, row.customScenario, row.customBasket, row.current);
}

/** A what-if estimate's figures, tied to the exact price it priced. */
export interface CampaignLiveFigures {
  price: string;
  figures: CampaignOptionFigures;
}

/**
 * The custom card's figures for the buffered price: a live what-if that priced exactly this
 * price, else the saved figures while the buffer still holds the saved price; otherwise none yet
 * (the estimate is on its way). Keying the live figures by price keeps a late answer for an older
 * price from describing the one now in the input.
 */
export function customOptionFigures(
  row: MarketplaceCampaignRow,
  presentation: CampaignScenarioPresentation,
  bufferedPrice: string | null,
  live: CampaignLiveFigures | undefined,
): CampaignOptionFigures | null {
  if (bufferedPrice === null) return null;
  if (live !== undefined && live.price === bufferedPrice) return live.figures;
  return savedCustomFigures(row, presentation, bufferedPrice);
}

const isPositive = (value: string | null): value is string =>
  value !== null && compareFixedDecimal(value, '0') > 0;

/**
 * Which of the two price options wears the "En kârlı" ribbon. The race is between the two
 * options only (design §7), and only when both have a figure on the SAME basis: two orders of a
 * different size are not comparable, so a price-sensitive basket whose quantity differs between
 * the options crowns neither. A loss is never "the most profitable", and a tie stays on the
 * maximum. Pure ordering over backend figures (no arithmetic).
 */
export function bestCampaignOption(
  max: CampaignOptionFigures,
  custom: CampaignOptionFigures | null,
): 'max' | 'custom' | null {
  if (custom === null) return null;
  if ((max.order?.quantity ?? null) !== (custom.order?.quantity ?? null)) return null;
  const maxProfit = max.netProfit;
  const customProfit = custom.netProfit;
  if (!isPositive(customProfit)) return isPositive(maxProfit) ? 'max' : null;
  if (!isPositive(maxProfit)) return 'custom';
  return compareFixedDecimal(customProfit, maxProfit) > 0 ? 'custom' : 'max';
}

/** A row's "En kârlı" winner — the one resolver the table and the mobile cards share. */
export function campaignRowBestOption(
  row: MarketplaceCampaignRow,
  presentation: CampaignScenarioPresentation,
  bufferedPrice: string | null,
  live: CampaignLiveFigures | undefined,
): 'max' | 'custom' | null {
  return bestCampaignOption(
    campaignOptionFigures(presentation, row.maxScenario, row.maxBasket, row.current),
    customOptionFigures(row, presentation, bufferedPrice, live),
  );
}

// ─── Filters ──────────────────────────────────────────────────────────────────

/** The detail toolbar's view state — a search string plus four independent chips. */
export interface CampaignFilterState {
  query: string;
  /** Keep only rows whose maximum-price option still nets a profit (> 0). */
  profitable: boolean;
  /** Keep only rows whose maximum-price option makes a loss (< 0). */
  losing: boolean;
  /** Keep only rows that join the campaign. */
  selected: boolean;
  /** Keep only rows carrying the commission-tariff warning. */
  tariffWarning: boolean;
}

/** True when the search box or any chip is active — drives the table's "clear filters" CTA. */
export function hasActiveCampaignFilters(filters: CampaignFilterState): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.profitable ||
    filters.losing ||
    filters.selected ||
    filters.tariffWarning
  );
}

/**
 * The file marks the product as sitting on a commission tariff ("Ürün Komisyon Tarifesi: Var"), yet
 * no uploaded tariff week covers the campaign, so its commission fell back to the product's own or
 * the category rate — the real rate may differ (design §4.3).
 */
export function hasCommissionTariffWarning(row: MarketplaceCampaignRow): boolean {
  return row.hasCommissionTariff && row.maxScenario.commissionSource !== 'band';
}

const isNegative = (value: string | null): value is string =>
  value !== null && compareFixedDecimal(value, '0') < 0;

/** The maximum-price option's headline profit — the figure the profit chips and smart-select judge. */
function maxOptionProfit(
  row: MarketplaceCampaignRow,
  presentation: CampaignScenarioPresentation,
): string | null {
  return campaignOptionFigures(presentation, row.maxScenario, row.maxBasket, row.current).netProfit;
}

/**
 * Applies the search + chip filters (pure). The profit chips read the maximum-price option's sign
 * on the row's own basis (unit, or the order on an ORDER campaign) — a comparison, never money
 * math; a not-calculable row matches neither. Search matches title, barcode and model code with the
 * same tr-locale lowercasing as every other list. Only the selection map is read (the "Seçililer"
 * chip), so a caller can memo on it alone and typing a custom price never re-runs the filter.
 */
export function filterCampaignRows(
  rows: readonly MarketplaceCampaignRow[],
  selection: CampaignSelectionMap,
  filters: CampaignFilterState,
  presentation: CampaignScenarioPresentation,
): MarketplaceCampaignRow[] {
  const needle = filters.query.trim().toLocaleLowerCase('tr');
  return rows.filter((row) => {
    if (
      needle !== '' &&
      ![row.productTitle, row.barcode, row.productCode].some((field) =>
        (field ?? '').toLocaleLowerCase('tr').includes(needle),
      )
    ) {
      return false;
    }
    if (filters.profitable && !isPositive(maxOptionProfit(row, presentation))) return false;
    if (filters.losing && !isNegative(maxOptionProfit(row, presentation))) return false;
    if (filters.selected && (selection[row.id] ?? null) === null) return false;
    if (filters.tariffWarning && !hasCommissionTariffWarning(row)) return false;
    return true;
  });
}

// ─── Bulk actions (callers pass the VISIBLE rows; hidden rows keep their choice) ─

/** "Tümünü maksimum fiyata çek": every given row joins at the maximum — a row that falls to a loss too. */
export function selectAllMax(
  rows: readonly MarketplaceCampaignRow[],
  state: CampaignChoiceState,
): CampaignChoiceState {
  const selection = { ...state.selection };
  for (const row of rows) selection[row.id] = 'MAX';
  return { ...state, selection };
}

/**
 * "Kârda kalanları seç": a row whose maximum-price option still nets a profit joins at the
 * maximum, every other row stops participating — the selection becomes exactly the profitable rows.
 * A row the seller joined with their OWN price is left as it is: that choice is deliberate, and its
 * profit hangs on a price this projection does not judge.
 */
export function selectProfitable(
  rows: readonly MarketplaceCampaignRow[],
  state: CampaignChoiceState,
  presentation: CampaignScenarioPresentation,
): CampaignChoiceState {
  const selection = { ...state.selection };
  for (const row of rows) {
    if (selection[row.id] === 'CUSTOM') continue;
    selection[row.id] = isPositive(maxOptionProfit(row, presentation)) ? 'MAX' : null;
  }
  return { ...state, selection };
}

/** "Seçimi temizle": the given rows leave the campaign and their typed custom prices are cleared. */
export function clearSelections(
  rows: readonly MarketplaceCampaignRow[],
  state: CampaignChoiceState,
): CampaignChoiceState {
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  for (const row of rows) {
    selection[row.id] = null;
    customPrices[row.id] = null;
  }
  return { selection, customPrices };
}

/** Why a target-margin run could not price a row — kept to mark the row's custom card. */
export type CampaignTargetMarginMark = 'UNREACHABLE' | 'NOT_CALCULABLE';

/**
 * "Hedef marja göre özel fiyat doldur": applies the backend's suggestions to the given rows. A
 * suggested price (the backend never suggests above the maximum) becomes the row's custom price and
 * the row joins with it. An UNREACHABLE row stops participating — no price up to the maximum keeps
 * the target margin. A NOT_CALCULABLE row keeps its choice: its cost, shipping or commission is
 * missing, so there is nothing to judge it by. Both come back as marks so the card can say why.
 */
export function applyTargetMarginSuggestions(
  rows: readonly MarketplaceCampaignRow[],
  state: CampaignChoiceState,
  suggestions: TargetMarginResult['suggestions'],
): {
  state: CampaignChoiceState;
  marks: Record<string, CampaignTargetMarginMark>;
  /** How many rows received a suggested price. */
  filled: number;
} {
  const byId = new Map(suggestions.map((suggestion) => [suggestion.itemId, suggestion]));
  const selection = { ...state.selection };
  const customPrices = { ...state.customPrices };
  const marks: Record<string, CampaignTargetMarginMark> = {};
  let filled = 0;
  for (const row of rows) {
    const suggestion = byId.get(row.id);
    if (suggestion === undefined) continue;
    if (suggestion.price !== null && customPriceStatus(suggestion.price, row) === 'valid') {
      customPrices[row.id] = suggestion.price;
      selection[row.id] = 'CUSTOM';
      filled += 1;
    } else if (suggestion.reason === 'UNREACHABLE') {
      selection[row.id] = null;
      marks[row.id] = 'UNREACHABLE';
    } else if (suggestion.reason === 'NOT_CALCULABLE') {
      marks[row.id] = 'NOT_CALCULABLE';
    }
  }
  return { state: { selection, customPrices }, marks, filled };
}
