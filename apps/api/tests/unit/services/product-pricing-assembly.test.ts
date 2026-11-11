import { describe, expect, it } from 'vitest';

import { deriveCalculable } from '../../../src/services/product-pricing-assembly';

describe('deriveCalculable', () => {
  it('true only when cost, shipping and commission are all OK', () => {
    expect(deriveCalculable('OK', 'OK', 'OK')).toBe(true);
  });
  it('false when any input is not OK', () => {
    expect(deriveCalculable('NO_PROFILES', 'OK', 'OK')).toBe(false);
    expect(deriveCalculable('OK', 'NO_CARRIER', 'OK')).toBe(false);
    expect(deriveCalculable('OK', 'OK', 'NO_RULE')).toBe(false);
  });
});
