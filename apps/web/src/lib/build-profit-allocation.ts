import { Decimal } from 'decimal.js';

import { CHART_POSITIVE } from '@/components/patterns/chart-colors';

/** The four allocation groups the sale splits into (sum to saleGross). */
export type ProfitGroupKey = 'cost' | 'marketplace' | 'taxes' | 'profit';

/**
 * Minimal structural shape the allocation reads: the backend-summed group totals
 * plus the sale + profit ends. Both the orders `ProfitBreakdown` and the campaign
 * estimate `QuoteBreakdown` satisfy it, so one helper serves both surfaces.
 */
export interface ProfitAllocationInput {
  saleGross: string;
  costGross: string;
  marketplaceFeesGross: string;
  taxesGross: string;
  netProfit: string;
}

export interface ProfitAllocationSegment {
  key: ProfitGroupKey;
  /** Backend-served group total (never summed on the frontend). */
  amount: string;
  /** Display share of the sale, 0..100 — bar width + group %. */
  percent: number;
  /** `var(--color-*)` token so the swatch swaps in dark mode. */
  color: string;
}

export interface ProfitAllocation {
  segments: ProfitAllocationSegment[];
  /** Draw the stacked bar only when the composition is cleanly non-negative. */
  barRenderable: boolean;
}

// Each group maps to a BACKEND-computed total (marketplaceFeesGross / taxesGross are
// summed in the profit engine — the frontend never adds money). Cost reserves the
// brand token; profit the positive token; taxes a neutral gray (not a semantic tone).
const GROUP_FIELDS = [
  { key: 'cost', field: 'costGross', color: 'var(--color-chart-1)' },
  { key: 'marketplace', field: 'marketplaceFeesGross', color: 'var(--color-chart-2)' },
  { key: 'taxes', field: 'taxesGross', color: 'var(--color-muted-foreground)' },
  { key: 'profit', field: 'netProfit', color: CHART_POSITIVE },
] as const satisfies ReadonlyArray<{
  key: ProfitGroupKey;
  field: keyof ProfitAllocationInput;
  color: string;
}>;

/**
 * Build the "satış nereye gitti" grouped composition — the sale split into the
 * three deduction groups (ürün maliyeti · pazaryeri kesintileri · vergiler) and
 * the profit tail. Group totals come straight from the backend
 * (`costGross` / `marketplaceFeesGross` / `taxesGross` / `netProfit`); only the
 * display shares are derived here — a presentation ratio, not a financial figure
 * (same class as `formatPercentDisplay`'s `/100`).
 *
 * `barRenderable` is false on a loss or a seller-favorable negative group, so the
 * caller skips the stacked bar; the group LIST still shows every value.
 */
export function buildProfitAllocation(breakdown: ProfitAllocationInput): ProfitAllocation {
  const total = new Decimal(breakdown.saleGross);
  const toPercent = (amount: string): number =>
    total.lte(0) ? 0 : new Decimal(amount).div(total).mul(100).toNumber();

  const segments: ProfitAllocationSegment[] = GROUP_FIELDS.map((group) => ({
    key: group.key,
    amount: breakdown[group.field],
    percent: toPercent(breakdown[group.field]),
    color: group.color,
  }));

  const barRenderable = total.gt(0) && segments.every((segment) => !segment.amount.startsWith('-'));

  return { segments, barRenderable };
}
