import { describe, expect, it } from 'vitest';

import { formatFxRateSource } from '../format-fx-rate-source';

describe('formatFxRateSource', () => {
  it('TRY-NATIVE: returns short label', () => {
    expect(formatFxRateSource('TRY-NATIVE')).toBe('TRY');
  });

  it('MANUAL: returns short label', () => {
    expect(formatFxRateSource('MANUAL')).toBe('Manuel');
  });

  it('TCMB-2026-05-09: returns "TCMB · 9 May 2026"', () => {
    const result = formatFxRateSource('TCMB-2026-05-09');
    // Accept either Turkish or English month names — the locale depends on the test env
    expect(result).toMatch(/TCMB/);
    expect(result).toMatch(/2026/);
  });

  it('TCMB-2026-01-01: includes year', () => {
    const result = formatFxRateSource('TCMB-2026-01-01');
    expect(result).toMatch(/TCMB/);
    expect(result).toMatch(/2026/);
  });

  it('unknown source: returned as-is', () => {
    expect(formatFxRateSource('SOME-OTHER-SOURCE')).toBe('SOME-OTHER-SOURCE');
  });

  it('empty string: returned as-is', () => {
    expect(formatFxRateSource('')).toBe('');
  });
});
