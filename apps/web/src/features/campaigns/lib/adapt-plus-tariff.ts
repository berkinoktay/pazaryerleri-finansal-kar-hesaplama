import type { PlusTariffDetail, PlusTariffDetailItem } from '../api/get-plus-tariff-detail.api';
import type { PlusTariffValidity } from '../types';

/**
 * A saved Plus tariff as the detail screen consumes it. Unlike the commission
 * tariff there are NO periods (a Plus tariff is a single 7-day window), so the
 * product rows are held directly. `exported` + `validity` are server-authoritative.
 */
export interface PlusTariffView {
  id: string;
  name: string;
  dateRangeLabel: string;
  validity: PlusTariffValidity;
  exported: boolean;
  rows: readonly PlusTariffDetailItem[];
}

/**
 * Maps the backend `PlusTariffDetail` to the detail screen's `PlusTariffView`.
 * Thin by design: the response already mirrors the component shapes (an item IS a
 * `PlusTariffDetailItem`), so this only renames `items` -> `rows` for the table.
 * No money math — the engine already computed every scenario's profit/margin.
 */
export function toPlusTariffView(detail: PlusTariffDetail): PlusTariffView {
  return {
    id: detail.id,
    name: detail.name,
    dateRangeLabel: detail.dateRangeLabel,
    validity: detail.validity,
    exported: detail.exported,
    rows: detail.items,
  };
}
