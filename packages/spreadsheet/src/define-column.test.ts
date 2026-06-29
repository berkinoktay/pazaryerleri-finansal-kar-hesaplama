import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { defineColumn } from './define-column';

interface Row {
  id: string;
  cost: Decimal;
  qty: number;
}

describe('defineColumn', () => {
  it('preserves the column def and narrows per-key types', () => {
    const col = defineColumn<Row, 'cost', 'decimal'>({
      key: 'cost',
      header: 'Cost',
      type: 'decimal',
      role: 'editable',
      format: (v) => v.toFixed(2), // v is Decimal
    });
    expect(col.key).toBe('cost');
    expect(col.type).toBe('decimal');
  });

  it('returns the same object identity', () => {
    const def = { key: 'id' as const, header: 'Id', type: 'string' as const, role: 'key' as const };
    expect(defineColumn<Row, 'id', 'string'>(def)).toBe(def);
  });
});
