/**
 * Display-only percentage formatter, shared across the web app.
 *
 * The backend hands percentages as plain decimal strings already expressed as
 * a percentage (e.g. `"13.4903"` means 13.49%). This renders them in the
 * Turkish convention — `%` prefix, comma decimal, two fraction digits —
 * regardless of how many digits the backend serialized. It is a presentation
 * helper (rounding for display), not a financial calculation: the magnitude is
 * preserved, never derived.
 *
 * Lives in `@/lib` because several features render backend-served percentages
 * (orders, live-performance, product-pricing) plus shared patterns
 * (profit-breakdown) — none of which may import from a feature.
 *
 * `null` (not calculable / undefined metric) renders an em-dash.
 */
const EM_DASH = '—';

export function formatPercentDisplay(value: string | null): string {
  if (value === null) return EM_DASH;
  return new Intl.NumberFormat('tr-TR', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) / 100);
}
