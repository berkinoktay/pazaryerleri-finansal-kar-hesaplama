import { describe, expect, it } from 'vitest';

import { isMicroExport, isPsfExempt } from '../resolve-fee-definition';

describe('isMicroExport', () => {
  it('returns true only when micro is exactly true', () => {
    expect(isMicroExport({ micro: true })).toBe(true);
  });

  it('returns false for a non-micro (domestic) order', () => {
    expect(isMicroExport({ micro: false })).toBe(false);
  });
});

describe('isPsfExempt', () => {
  it('exempts a micro export order from PSF regardless of items', () => {
    // Mikro ihracatta PSF uygulanmaz (Uluslararası Hizmet Bedeli onun yerine geçer).
    expect(isPsfExempt({ micro: true, items: [] })).toBe(true);
  });

  it('does not exempt a domestic order with physical items', () => {
    expect(isPsfExempt({ micro: false, items: [{ productVariant: { isDigital: false } }] })).toBe(
      false,
    );
  });

  it('exempts a domestic order whose items are all digital', () => {
    expect(isPsfExempt({ micro: false, items: [{ productVariant: { isDigital: true } }] })).toBe(
      true,
    );
  });
});
