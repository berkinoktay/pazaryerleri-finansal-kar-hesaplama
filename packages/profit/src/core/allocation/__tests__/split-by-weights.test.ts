import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { InvalidAllocationError, splitByWeights } from '../split-by-weights';

const D = (v: string): Decimal => new Decimal(v);
const asText = (xs: Decimal[]): string[] => xs.map((x) => x.toFixed(2));

describe('splitByWeights', () => {
  it.each([
    ['90', ['50', '80'], ['34.62', '55.38']],
    ['13.19', ['1', '1', '1'], ['4.40', '4.40', '4.39']],
    ['0.01', ['1', '1'], ['0.01', '0.00']],
    ['100', ['1'], ['100.00']],
    ['10', ['0', '5'], ['0.00', '10.00']], // Review focus 2
    ['10', ['0', '0'], ['5.00', '5.00']], // Review focus 2
    ['0', ['1', '2'], ['0.00', '0.00']], // Review focus 2
  ] as const)('splits %s by %j into %j', (total, weights, expected) => {
    const parts = splitByWeights(D(total), weights.map(D));
    expect(asText(parts)).toEqual(expected);
    expect(parts.reduce((s, p) => s.add(p), D('0')).toFixed(2)).toBe(D(total).toFixed(2));
  });
  it('rejects negative weights, empty weights and sub-cent totals', () => {
    expect(() => splitByWeights(D('10'), [D('-1'), D('2')])).toThrow(InvalidAllocationError);
    expect(() => splitByWeights(D('10'), [])).toThrow(InvalidAllocationError);
    expect(() => splitByWeights(D('10.005'), [D('1')])).toThrow(InvalidAllocationError);
  });
});
