import { describe, expect, it } from 'vitest';

import { parseFlashWindowCell } from '@/services/flash-product-import.service';

// The flash import parses each window date cell into the TRUE instant. Trendyol stamps
// the window as an Istanbul wall clock ("08/07/2026 00:00" text), but read-excel-file
// hands a date-formatted cell back as a naive UTC Date — the same wall-clock components
// embedded as if they were UTC, i.e. ~3h ahead. Both inputs must resolve to the same
// instant so a window near a sub-period boundary never falls into the wrong commission band.
describe('parseFlashWindowCell', () => {
  // 08/07/2026 00:00 Istanbul (UTC+3) → the real instant is 2026-07-07T21:00:00Z.
  const EXPECTED_INSTANT = '2026-07-07T21:00:00.000Z';

  it('parses the text cell "08/07/2026 00:00" as the true Istanbul instant', () => {
    const parsed = parseFlashWindowCell(['08/07/2026 00:00'], 0);
    expect(parsed?.toISOString()).toBe(EXPECTED_INSTANT);
  });

  it('normalises a naive-UTC Date cell to the SAME instant as the text cell', () => {
    // How read-excel-file returns the date cell: wall-clock components as UTC.
    const naiveUtcDate = new Date(Date.UTC(2026, 6, 8, 0, 0));
    const parsed = parseFlashWindowCell([naiveUtcDate], 0);
    expect(parsed?.toISOString()).toBe(EXPECTED_INSTANT);
  });

  it('returns null for a negative column index or an empty cell', () => {
    expect(parseFlashWindowCell(['08/07/2026 00:00'], -1)).toBeNull();
    expect(parseFlashWindowCell([null], 0)).toBeNull();
  });
});
