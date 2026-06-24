/**
 * Map a backend-served money / percent string to a semantic tone class by its
 * SIGN ONLY — no arithmetic (the frontend never computes money). Positive →
 * success, negative → destructive, zero / empty / null → neutral (no class).
 * Used to color profit + margin cells in the orders table.
 */
export function profitToneClass(value: string | null): string {
  if (value === null || value === '' || value === '0' || value === '0.00') return '';
  return value.startsWith('-') ? 'text-destructive' : 'text-success';
}
