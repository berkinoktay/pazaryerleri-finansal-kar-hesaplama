import { Decimal } from 'decimal.js';
import { ProfitLineLevel, ProfitLineType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../__tests__/helpers/make-profit-line';
import { createProfitLine, InvalidProfitLineError } from '../profit-line';

describe('createProfitLine', () => {
  it('accepts a valid item line', () => {
    const line = makeLine({ type: ProfitLineType.SALE, gross: '491.28', vat: '44.66' });
    expect(line.level).toBe(ProfitLineLevel.ITEM);
    expect(line.orderItemId).toBe('item-1');
  });
  it('rejects an ITEM line without orderItemId', () => {
    expect(() => makeLine({ type: ProfitLineType.SALE, gross: '1', orderItemId: null })).toThrow(
      InvalidProfitLineError,
    );
  });
  it('rejects a PARCEL line with orderItemId', () => {
    expect(() =>
      makeLine({
        type: ProfitLineType.SHIPPING,
        gross: '1',
        level: ProfitLineLevel.PARCEL,
        orderItemId: 'item-1',
      }),
    ).toThrow(InvalidProfitLineError);
  });
  it('rejects a level the catalog does not allow', () => {
    expect(() =>
      makeLine({
        type: ProfitLineType.SHIPPING,
        gross: '1',
        level: ProfitLineLevel.ITEM,
        orderItemId: 'item-1',
      }),
    ).toThrow(InvalidProfitLineError);
  });
  it('rejects negative amounts', () => {
    expect(() => makeLine({ type: ProfitLineType.COMMISSION, gross: '-1' })).toThrow(
      InvalidProfitLineError,
    );
  });
  it('rejects amounts with more than two decimals', () => {
    // Review focus 5
    expect(() => makeLine({ type: ProfitLineType.COMMISSION, gross: '1.005' })).toThrow(
      InvalidProfitLineError,
    );
  });
  it('rejects non-finite amounts', () => {
    expect(() => makeLine({ type: ProfitLineType.COMMISSION, gross: 'Infinity' })).toThrow(
      InvalidProfitLineError,
    );
    expect(() => makeLine({ type: ProfitLineType.COMMISSION, gross: 'NaN' })).toThrow(
      InvalidProfitLineError,
    );
  });
  it('rejects NATIVE fx with a rate other than 1', () => {
    const base = makeLine({ type: ProfitLineType.SALE, gross: '10' });
    expect(() => createProfitLine({ ...base, fx: { ...base.fx, rate: new Decimal('2') } })).toThrow(
      InvalidProfitLineError,
    );
  });
});
