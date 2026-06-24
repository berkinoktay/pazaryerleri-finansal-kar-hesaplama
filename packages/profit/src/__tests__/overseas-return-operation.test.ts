import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { overseasReturnOperationGross } from '../overseas-return-operation';

const D = (v: string | number) => new Decimal(v);

describe('overseasReturnOperationGross', () => {
  it('returns 0 for no accepted legs', () => {
    expect(overseasReturnOperationGross([]).toString()).toBe('0');
  });

  it('charges (sale − commission) × rate for a ≤2000₺ product (%35)', () => {
    // hakediş = 1500 − 285 = 1215; bedel = 1215 × 0.35 = 425.25
    const gross = overseasReturnOperationGross([
      { acceptedSaleGross: D('1500'), acceptedCommissionGross: D('285'), rate: D('0.35') },
    ]);
    expect(gross.toString()).toBe('425.25');
  });

  it('uses the >2000₺ rate (%30) when the tier resolver supplies it', () => {
    // hakediş = 2500 − 475 = 2025; bedel = 2025 × 0.30 = 607.5
    const gross = overseasReturnOperationGross([
      { acceptedSaleGross: D('2500'), acceptedCommissionGross: D('475'), rate: D('0.30') },
    ]);
    expect(gross.toString()).toBe('607.5');
  });

  it('clamps a leg to 0 when commission exceeds sale (anomaly, no negative fee)', () => {
    const gross = overseasReturnOperationGross([
      { acceptedSaleGross: D('100'), acceptedCommissionGross: D('150'), rate: D('0.35') },
    ]);
    expect(gross.toString()).toBe('0');
  });

  it('sums multiple accepted legs', () => {
    const gross = overseasReturnOperationGross([
      { acceptedSaleGross: D('1500'), acceptedCommissionGross: D('285'), rate: D('0.35') }, // 425.25
      { acceptedSaleGross: D('2500'), acceptedCommissionGross: D('475'), rate: D('0.30') }, // 607.5
    ]);
    expect(gross.toString()).toBe('1032.75');
  });
});
