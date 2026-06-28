import { describe, expect, it } from 'vitest';

import { formatPercentDisplay } from '@/lib/format-percent';

describe('formatPercentDisplay', () => {
  it('formats a backend percent-unit string in tr-TR (% prefix, comma, 2 fraction digits)', () => {
    // The backend serves the magnitude already expressed as a percent ("19.3518"
    // means 19.35%); we only round for display, never derive.
    expect(formatPercentDisplay('19.3518')).toBe('%19,35');
    expect(formatPercentDisplay('38.7036')).toBe('%38,70');
  });

  it('keeps exactly two fraction digits even for short inputs', () => {
    expect(formatPercentDisplay('15.5')).toBe('%15,50');
    expect(formatPercentDisplay('40')).toBe('%40,00');
  });

  it('places the sign before the percent glyph for losses', () => {
    expect(formatPercentDisplay('-5.0')).toBe('-%5,00');
  });

  it('renders an em-dash for a null (non-calculable) metric', () => {
    expect(formatPercentDisplay(null)).toBe('—');
  });
});
