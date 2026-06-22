import { describe, expect, it } from 'vitest';

import { canWriteMarketplacePrice } from '@/features/product-pricing/lib/can-write-price';

describe('canWriteMarketplacePrice', () => {
  it('allows OWNER and ADMIN (mirrors the backend OWNER/ADMIN price-write gate)', () => {
    expect(canWriteMarketplacePrice('OWNER')).toBe(true);
    expect(canWriteMarketplacePrice('ADMIN')).toBe(true);
  });

  it('denies MEMBER and VIEWER even though MEMBER holds the generic data:write capability', () => {
    expect(canWriteMarketplacePrice('MEMBER')).toBe(false);
    expect(canWriteMarketplacePrice('VIEWER')).toBe(false);
  });
});
