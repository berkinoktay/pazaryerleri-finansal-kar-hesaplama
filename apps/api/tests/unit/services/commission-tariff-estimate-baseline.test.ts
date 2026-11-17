// The price the commission tariff estimate's current scenario prices at
// (`currentBaselinePrice`): the commission-base price, else the current price, else null.
// The route-level 422 for a null baseline runs against real rows in the integration
// suite (commission-tariffs-estimate.routes.test.ts).

import { Prisma } from '@pazarsync/db';
import { describe, expect, it } from 'vitest';

import { currentBaselinePrice } from '@/services/commission-tariff-estimate.service';

describe('currentBaselinePrice', () => {
  it('prefers the commission base price', () => {
    const price = currentBaselinePrice({
      commissionBasePrice: new Prisma.Decimal('449.90'),
      currentPrice: new Prisma.Decimal('499.90'),
    });

    expect(price?.toFixed(2)).toBe('449.90');
  });

  it('falls back to the current price', () => {
    const price = currentBaselinePrice({
      commissionBasePrice: null,
      currentPrice: new Prisma.Decimal('499.90'),
    });

    expect(price?.toFixed(2)).toBe('499.90');
  });

  it('is null when both are unknown', () => {
    expect(currentBaselinePrice({ commissionBasePrice: null, currentPrice: null })).toBeNull();
  });
});
