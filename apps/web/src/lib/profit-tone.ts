/**
 * Map a backend-served money / percent string to a semantic tone class by its
 * SIGN ONLY — no arithmetic (the frontend never computes money). Positive ->
 * success, negative -> destructive, zero / empty / null -> neutral (no class).
 *
 * Used wherever a cell's OFF-state color is driven by the sign of its value:
 * net-profit columns in the orders table, the margin-coloring preview strip.
 * Promoted from features/orders/lib/profit-tone to @/lib because the account
 * feature also needs it (margin-coloring settings preview).
 */
export function profitToneClass(value: string | null): string {
  if (value === null || value === '' || value === '0' || value === '0.00') return '';
  return value.startsWith('-') ? 'text-destructive' : 'text-success';
}
