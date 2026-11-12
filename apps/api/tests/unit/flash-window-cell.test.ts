import { describe, expect, it } from 'vitest';

import { parseFlashWindowCell } from '@/services/flash-product-import.service';

// A date-styled cell that holds a huge serial reaches the grid as an Invalid Date. The
// window parser must read it as an absent window instead of throwing a RangeError,
// which surfaced as a 500 on import.
describe('parseFlashWindowCell with an Invalid Date cell', () => {
  it('reads an Invalid Date cell as null', () => {
    expect(parseFlashWindowCell([new Date(Number.NaN)], 0)).toBeNull();
  });
});
