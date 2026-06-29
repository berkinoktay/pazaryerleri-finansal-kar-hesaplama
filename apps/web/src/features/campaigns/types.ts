import type { Decimal } from 'decimal.js';

/**
 * A product participates in a commission tariff across exactly four price
 * bands. Each band has its own threshold, commission rate, and (mocked here)
 * resulting profit. The seller picks one band to join.
 */
export type BandKey = 'band1' | 'band2' | 'band3' | 'band4';

export interface PriceBand {
  key: BandKey;
  /** Threshold label as shown to the seller, e.g. "777,09₺ ve altı". */
  thresholdLabel: string;
  /** Numeric boundary of the band (the value in `thresholdLabel`). Used to map a
   *  custom price to the band whose range it falls into. */
  threshold: Decimal;
  /** Commission fraction, e.g. 0.131 = %13,1. */
  commissionPct: Decimal;
  /** Resulting net profit at this band (mocked; the real engine computes it). */
  profit: Decimal;
  /** Margin percent as a plain string for margin-coloring, e.g. "9.11". */
  marginPct: string;
}

export interface CommissionTariffRow {
  id: string;
  productTitle: string;
  category: string;
  brand: string;
  modelCode: string;
  barcode: string;
  stock: number;
  currentPrice: Decimal;
  /** Price the customer sees (after any storefront discount). Mock: == currentPrice. */
  displayPrice: Decimal;
  /** Current (off-tariff) commission fraction. */
  currentCommissionPct: Decimal;
  /** Non-commission unit cost basis (product cost + shipping + other). Used to
   *  estimate profit at a custom price: price − price·commission − unitCost. */
  unitCost: Decimal;
  bands: readonly [PriceBand, PriceBand, PriceBand, PriceBand];
  /** The most profitable band — highlighted in the UI. */
  bestBand: BandKey;
}

/** A saved tariff's validity relative to today, for the list status column. */
export type TariffValidity = 'active' | 'upcoming' | 'past';

/**
 * A tariff period (one piece of a tariff). The number, labels, and structure
 * of periods come entirely from the uploaded data — there is intentionally NO
 * fixed "3-day"/"4-day" enum, because Trendyol's tariff structure varies (one
 * 7-day period, a 3+4 split, or something else next week). `id` is an opaque
 * identifier for URL state + selection; `dateRangeLabel` is the human label
 * straight from the tariff source.
 */
export interface TariffPeriod {
  id: string;
  dateRangeLabel: string;
  rows: readonly CommissionTariffRow[];
}

/**
 * A saved tariff set. The seller uploads a tariff Excel (we can't auto-fetch
 * upcoming weeks — Trendyol has no such service), and each upload is kept as a
 * separate, editable, deletable template. `name` defaults to the date range but
 * is the human label shown on the tab. Each template owns its own band
 * selections (held by the page, keyed by template id).
 */
export interface TariffTemplate {
  id: string;
  name: string;
  /** One period (single tariff) or several (split tariff) — data-driven. */
  periods: readonly TariffPeriod[];
  /** Whether this tariff's date range is active / upcoming / past relative to today. */
  validity: TariffValidity;
  /** Human "last updated" label, e.g. "2 gün önce" (mock; real value from the row). */
  updatedLabel: string;
}
