/**
 * Display-only percentage formatter for the product-pricing surfaces.
 *
 * The backend hands percentages as plain decimal strings already expressed as
 * a percentage (e.g. `"13.4903"` means 13.49%). This renders them in the
 * Turkish convention — `%` prefix, comma decimal, two fraction digits —
 * regardless of how many digits the backend serialized. It is a presentation
 * helper (rounding for display), not a financial calculation: the magnitude is
 * preserved, never derived.
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
