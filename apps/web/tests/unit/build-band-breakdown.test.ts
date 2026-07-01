import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { buildBandBreakdown } from '@/features/campaigns/lib/build-band-breakdown';
import type { CommissionTariffRow, PriceBand } from '@/features/campaigns/types';

const band: PriceBand = {
  key: 'band2',
  thresholdLabel: '700₺ ve altı',
  threshold: new Decimal('700'),
  commissionPct: new Decimal('0.10'),
  profit: new Decimal('30'),
  marginPct: '4.29',
};

const row: CommissionTariffRow = {
  id: 'r1',
  productTitle: 'Ürün',
  category: 'Kat',
  brand: 'Marka',
  modelCode: 'M1',
  barcode: '123',
  stock: 5,
  currentPrice: new Decimal('800'),
  displayPrice: new Decimal('800'),
  currentCommissionPct: new Decimal('0.19'),
  unitCost: new Decimal('600'),
  bands: [band, band, band, band],
  bestBand: 'band2',
};

describe('buildBandBreakdown', () => {
  it('prices a discount band at its threshold and derives the commission amount', () => {
    const b = buildBandBreakdown(row, band, false);
    expect(b.price.toString()).toBe('700');
    // commission = 700 × 0.10
    expect(b.commission.toString()).toBe('70');
    expect(b.unitCost.toString()).toBe('600');
    // price − commission − unitCost = profit (700 − 70 − 600 = 30)
    expect(b.price.minus(b.commission).minus(b.unitCost).toString()).toBe(b.profit.toString());
  });

  it('prices the current band at the live current price', () => {
    const b = buildBandBreakdown(row, band, true);
    expect(b.price.toString()).toBe('800');
    // commission = 800 × 0.10
    expect(b.commission.toString()).toBe('80');
  });
});
