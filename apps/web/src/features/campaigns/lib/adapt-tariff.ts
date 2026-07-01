import type { CommissionTariffDetail } from '../api/get-tariff-detail.api';
import type { TariffTemplate } from '../types';

/**
 * Maps the backend `CommissionTariffDetail` to the detail screen's
 * `TariffTemplate`. Thin by design: the response mirrors the component shapes
 * (a band IS a `PriceBand`, an item IS a `CommissionTariffRow`), so this only
 * renames each period's `items` → `rows`. No money math — the engine already
 * computed every profit/margin.
 */
export function toDetailTemplate(detail: CommissionTariffDetail): TariffTemplate {
  return {
    id: detail.id,
    name: detail.name,
    exported: detail.exported,
    periods: detail.periods.map((period) => ({
      id: period.id,
      dateRangeLabel: period.dateRangeLabel,
      validity: period.validity,
      rows: period.items,
    })),
  };
}
