import { Decimal } from 'decimal.js';
import { ProfitLineLevel, ProfitLineType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../../__tests__/helpers/make-profit-line';
import { type ProfitLine } from '../../../core/profit-line';
import { vatFromGross } from '../vat';
import { computeVatTotals, effectiveNetVat } from '../net-vat';

const melontikLines = (): ProfitLine[] => [
  makeLine({ type: ProfitLineType.SALE, gross: '491.28', vat: '44.66', orderItemId: 'item-a' }),
  makeLine({ type: ProfitLineType.SALE, gross: '380.47', vat: '34.59', orderItemId: 'item-b' }),
  makeLine({
    type: ProfitLineType.COST_COGS,
    gross: '233.00',
    vat: '21.18',
    orderItemId: 'item-a',
  }),
  makeLine({
    type: ProfitLineType.COST_COGS,
    gross: '165.00',
    vat: '15.00',
    orderItemId: 'item-b',
  }),
  makeLine({
    type: ProfitLineType.COMMISSION,
    gross: '93.34',
    vat: '15.56',
    orderItemId: 'item-a',
  }),
  makeLine({
    type: ProfitLineType.COMMISSION,
    gross: '72.29',
    vat: '12.05',
    orderItemId: 'item-b',
  }),
  makeLine({ type: ProfitLineType.SHIPPING, gross: '98.34', vat: '16.39' }),
  makeLine({
    type: ProfitLineType.SERVICE_FEE,
    gross: '13.19',
    vat: '2.20',
    level: ProfitLineLevel.PARCEL,
    orderItemId: null,
  }),
  makeLine({ type: ProfitLineType.STOPPAGE, gross: '4.47', orderItemId: 'item-a' }),
  makeLine({ type: ProfitLineType.STOPPAGE, gross: '3.46', orderItemId: 'item-b' }),
];

describe('computeVatTotals', () => {
  it('reproduces the melontik order VAT', () => {
    const t = computeVatTotals(melontikLines());
    expect(t.output.toFixed(2)).toBe('79.25');
    expect(t.input.toFixed(2)).toBe('82.38');
    expect(t.net.toFixed(2)).toBe('-3.13');
  });
  it('a sale return reduces output VAT and a commission refund reduces input VAT', () => {
    const t = computeVatTotals([
      makeLine({ type: ProfitLineType.SALE, gross: '120', vat: '20' }),
      makeLine({ type: ProfitLineType.SALE_RETURN, gross: '60', vat: '10' }),
      makeLine({ type: ProfitLineType.COMMISSION, gross: '24', vat: '4' }),
      makeLine({ type: ProfitLineType.COMMISSION_REFUND, gross: '12', vat: '2' }),
    ]);
    expect(t.output.toFixed(2)).toBe('10.00');
    expect(t.input.toFixed(2)).toBe('2.00');
    expect(t.net.toFixed(2)).toBe('8.00');
  });
  it('sums per-line rounded VAT instead of re-rounding the order total', () => {
    // Review focus 1
    const vat = vatFromGross(new Decimal('33.33'), new Decimal('20')).toFixed(2); // '5.56'
    const lines = ['item-1', 'item-2', 'item-3'].map((id) =>
      makeLine({ type: ProfitLineType.SALE, gross: '33.33', vat, orderItemId: id }),
    );
    expect(computeVatTotals(lines).output.toFixed(2)).toBe('16.68'); // order-level 99.99 would round to 16.67
  });
});

describe('effectiveNetVat', () => {
  it.each([
    ['-3.13', false, false, '0.00'],
    ['-3.13', true, false, '-3.13'],
    ['-3.13', false, true, '-3.13'],
    ['5.00', false, false, '5.00'],
  ])(
    'net %s, includeNegative=%s, export=%s -> %s',
    (net, includeNegativeNetVat, isExportSale, expected) => {
      expect(
        effectiveNetVat(new Decimal(net), { includeNegativeNetVat, isExportSale }).toFixed(2),
      ).toBe(expected);
    },
  );
});
