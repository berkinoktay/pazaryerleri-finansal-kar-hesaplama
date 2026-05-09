/**
 * Formats a raw FX rate source string into a concise human-readable label.
 *
 * Source strings produced by the backend:
 *   - 'TRY-NATIVE' — no conversion needed, cost is in TRY
 *   - 'MANUAL' — seller provided a fixed manual rate
 *   - 'TCMB-YYYY-MM-DD' — rate fetched from TCMB on the given date
 *   - any other string — returned as-is (forward-compatible)
 *
 * Output examples:
 *   - 'TRY-NATIVE'  → 'TRY'
 *   - 'MANUAL'      → 'Manuel'
 *   - 'TCMB-2026-05-09' → 'TCMB · 9 May 2026'
 */
export function formatFxRateSource(source: string): string {
  if (source === 'TRY-NATIVE') return 'TRY';
  if (source === 'MANUAL') return 'Manuel';

  if (source.startsWith('TCMB-')) {
    const datePart = source.slice(5); // 'YYYY-MM-DD'
    const parsed = new Date(`${datePart}T12:00:00Z`); // noon UTC avoids timezone drift
    if (!Number.isNaN(parsed.getTime())) {
      const formatted = parsed.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
      return `TCMB · ${formatted}`;
    }
  }

  return source;
}
