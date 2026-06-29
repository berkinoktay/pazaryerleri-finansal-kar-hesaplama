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
  /** Current (off-tariff) commission fraction. */
  currentCommissionPct: Decimal;
  bands: readonly [PriceBand, PriceBand, PriceBand, PriceBand];
  /** The most profitable band — highlighted in the UI. */
  bestBand: BandKey;
}

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

/** A tariff view (e.g. this week / next week). Its label comes from the data. */
export interface TariffWeek {
  id: string;
  label: string;
  /** One period (single tariff) or several (split tariff) — data-driven. */
  periods: readonly TariffPeriod[];
}
