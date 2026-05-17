import { describe, expect, it } from 'vitest';

import { formatCarrierChip } from '@/features/shipping/lib/format-carrier-chip';

describe('formatCarrierChip', () => {
  it('returns null when both fields are missing', () => {
    expect(formatCarrierChip(null, null)).toBeNull();
  });

  it('returns null when only the code is missing', () => {
    expect(formatCarrierChip(null, 'BAREM')).toBeNull();
  });

  it('returns null when only the tariff is missing', () => {
    expect(formatCarrierChip('SENDEOMP', null)).toBeNull();
  });

  it('formats the BAREM lane as "<code> · Barem"', () => {
    expect(formatCarrierChip('SENDEOMP', 'BAREM')).toBe('SENDEOMP · Barem');
  });

  it('formats the NORMAL lane as "<code> · Normal"', () => {
    expect(formatCarrierChip('ARASMP', 'NORMAL')).toBe('ARASMP · Normal');
  });

  it('formats OWN_CONTRACT as the localized own-contract label (carrier code ignored)', () => {
    expect(formatCarrierChip('OWN', 'OWN_CONTRACT')).toBe('Kendi anlaşma');
  });
});
