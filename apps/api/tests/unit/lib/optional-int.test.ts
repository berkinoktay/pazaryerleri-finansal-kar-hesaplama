import { describe, expect, it } from 'vitest';

import { intOrNull } from '@/lib/optional-int';

describe('intOrNull', () => {
  it('is null when the field was not sent', () => {
    expect(intOrNull(undefined)).toBeNull();
  });

  it('reads a digit string as its integer', () => {
    expect(intOrNull('3')).toBe(3);
    expect(intOrNull('0')).toBe(0);
    expect(intOrNull('120')).toBe(120);
  });
});
