import type { components } from '@pazarsync/api-client';

import type { TariffBandResult, TariffDetailItem } from './api/get-tariff-detail.api';

/**
 * Component-facing shapes for the commission-tariffs UI. Money is a GROSS decimal
 * STRING and `commissionPct` a PERCENT string (e.g. "13.1") — exactly as the
 * backend serializes them; the frontend renders, never computes (profit/margin
 * come pre-computed from the engine). Uncalculable rows/bands carry `null`
 * profit/margin, so every consumer must null-guard.
 */

/** One of the four price bands (band1 = current tier … band4 = lowest window). */
export type BandKey = 'band1' | 'band2' | 'band3' | 'band4';

/**
 * A price band with its backend-computed profit. Identical in shape to the API's
 * `TariffBandResult` — aliased so the components have a domain name and one place
 * to evolve if the wire ever diverges. `netProfit`/`marginPct` are null when the
 * row is not calculable.
 */
export type PriceBand = TariffBandResult;

/**
 * A tariff product row. Identical to the API's `TariffDetailItem`: it already
 * carries `calculable` / `reason`, the server-authoritative `selectedBand` +
 * `customPrice`, `bestBandKey`, and a variable-length `bands` array.
 */
export type CommissionTariffRow = TariffDetailItem;

/** A saved tariff's validity relative to today, for the list + period badges. */
export type TariffValidity = 'active' | 'upcoming' | 'past';

/**
 * A tariff period (one piece of a tariff). Mirrors the API period but renames
 * `items` → `rows` for the table. Per-period `validity` comes from the parsed
 * date range (null when unparseable).
 */
export interface TariffPeriod {
  id: string;
  dateRangeLabel: string;
  validity: TariffValidity | null;
  rows: readonly CommissionTariffRow[];
}

/**
 * A saved tariff (one uploaded Excel), as consumed by the detail screen. Periods
 * are data-driven (one period, or a split). `exported` is server-authoritative.
 */
export interface TariffTemplate {
  id: string;
  name: string;
  exported: boolean;
  periods: readonly TariffPeriod[];
}

/**
 * Component-facing Plus commission-tariff shapes, re-exported from the api layer so
 * the UI has one import site. Money is a GROSS decimal STRING and `commissionPct` a
 * PERCENT string, exactly as the backend serializes — the frontend renders, never
 * computes. Uncalculable rows carry `null` profit/margin, so every consumer must
 * null-guard. Unlike the commission detail there are NO periods: a Plus tariff is a
 * single 7-day window whose product rows are consumed directly.
 */
export type {
  PlusTariffDetail,
  PlusTariffDetailItem,
  PlusScenario,
} from './api/get-plus-tariff-detail.api';
export type { PlusTariffListItem } from './api/list-plus-tariffs.api';

/** A Plus tariff's validity relative to today (null when the period dates are unparseable). */
export type PlusTariffValidity = components['schemas']['PlusTariffValidity'];
