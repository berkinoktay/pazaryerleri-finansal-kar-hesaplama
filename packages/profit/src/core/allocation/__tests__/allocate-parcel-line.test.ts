import { Decimal } from 'decimal.js';
import { ProfitLineLevel, ProfitLineType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../../__tests__/helpers/make-profit-line';
import { allocateParcelLine, InvalidAllocationError } from '../allocate-parcel-line';

const D = (v: string): Decimal => new Decimal(v);

describe('allocateParcelLine', () => {
  const tshirt = { orderItemId: 'tshirt', saleGross: D('299'), standaloneAmount: D('50') };
  const shoe = { orderItemId: 'shoe', saleGross: D('1499'), standaloneAmount: D('80') };
  it('splits shipping by standalone shipping amounts', () => {
    const line = makeLine({ type: ProfitLineType.SHIPPING, gross: '90', vat: '15' });
    const out = allocateParcelLine(line, [tshirt, shoe]);
    expect(out.map((a) => a.amount.gross.toFixed(2))).toEqual(['34.62', '55.38']);
    expect(out.map((a) => a.amount.vat.toFixed(2))).toEqual(['5.77', '9.23']);
    expect(out.every((a) => a.basisUsed === 'STANDALONE_AMOUNT')).toBe(true);
  });
  it('falls back to sale share when a standalone amount is missing', () => {
    const line = makeLine({ type: ProfitLineType.SHIPPING, gross: '90', vat: '15' });
    const out = allocateParcelLine(line, [{ ...tshirt, standaloneAmount: null }, shoe]);
    expect(out.every((a) => a.basisUsed === 'SALE_SHARE')).toBe(true);
  });
  it('splits a fixed service fee equally', () => {
    const line = makeLine({
      type: ProfitLineType.SERVICE_FEE,
      gross: '13.19',
      vat: '2.20',
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
    });
    const items = ['a', 'b', 'c'].map((id) => ({
      orderItemId: id,
      saleGross: D('100'),
      standaloneAmount: null,
    }));
    const out = allocateParcelLine(line, items);
    expect(out.map((a) => a.amount.gross.toFixed(2))).toEqual(['4.40', '4.40', '4.39']);
    expect(out.map((a) => a.amount.vat.toFixed(2))).toEqual(['0.74', '0.73', '0.73']);
  });
  it('rejects an item-level line', () => {
    const line = makeLine({ type: ProfitLineType.COMMISSION, gross: '10' });
    expect(() => allocateParcelLine(line, [tshirt])).toThrow(InvalidAllocationError);
  });
});
