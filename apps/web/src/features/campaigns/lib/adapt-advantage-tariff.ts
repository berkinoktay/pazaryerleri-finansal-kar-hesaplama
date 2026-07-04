import type {
  AdvantageCommissionSource,
  AdvantageTariffDetail,
  AdvantageTariffDetailItem,
  CommissionSourceMode,
} from '../api/get-advantage-tariff-detail.api';

/**
 * A saved Advantage tariff as the detail screen consumes it. Unlike the commission
 * tariff there are NO periods and NO validity — an Advantage file carries no dates —
 * so the product rows are held directly. `exported` + the commission-source meta are
 * server-authoritative.
 */
export interface AdvantageTariffView {
  id: string;
  name: string;
  exported: boolean;
  /** How the reduced commission is sourced: active period (auto) / pinned (override) / none. */
  commissionSourceMode: CommissionSourceMode;
  /** Which commission tariff/period supplies the rates, or null when none applies. */
  commissionSource: AdvantageCommissionSource;
  /** True when a H="Var" product failed to match the active commission tariff (drives the C hybrid warning). */
  hasUnmatchedCommissionProducts: boolean;
  rows: readonly AdvantageTariffDetailItem[];
}

/**
 * Maps the backend `AdvantageTariffDetail` to the detail screen's `AdvantageTariffView`.
 * Thin by design: the response already mirrors the component shapes (an item IS an
 * `AdvantageTariffDetailItem`), so this only renames `items` → `rows` for the table and
 * lifts the commission-source meta. No money math — the engine already computed every
 * tier's profit/margin.
 */
export function toAdvantageTariffView(detail: AdvantageTariffDetail): AdvantageTariffView {
  return {
    id: detail.id,
    name: detail.name,
    exported: detail.exported,
    commissionSourceMode: detail.commissionSourceMode,
    commissionSource: detail.commissionSource,
    hasUnmatchedCommissionProducts: detail.hasUnmatchedCommissionProducts,
    rows: detail.items,
  };
}
