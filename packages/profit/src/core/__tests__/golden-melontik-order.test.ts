import { Decimal } from 'decimal.js';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatus,
} from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../__tests__/helpers/make-profit-line';
import { netSaleStoppageBase, stoppageAmount } from '../../tax/tr/stoppage';
import { vatFromGross } from '../../tax/tr/vat';
import { type ProfitLine } from '../profit-line';
import { computeProfitStatement } from '../profit-statement';

const SALE_VAT_RATE = new Decimal('10');
const COST_VAT_RATE = new Decimal('10');
const FEE_VAT_RATE = new Decimal('20');
const STOPPAGE_RATE = new Decimal('1');

/** VAT as a two-decimal string so it can feed `makeLine` (which takes text amounts). */
function vatText(gross: string, ratePct: Decimal): string {
  return vatFromGross(new Decimal(gross), ratePct).toFixed(2);
}

/** Stoppage withheld on the VAT-exclusive sale, as a two-decimal string. */
function stoppageText(saleGross: string, saleVat: string): string {
  const base = netSaleStoppageBase({ gross: new Decimal(saleGross), vat: new Decimal(saleVat) });
  return stoppageAmount(base, STOPPAGE_RATE).toFixed(2);
}

/**
 * The real, kurus-closing melontik order 11761487239: two items, sale VAT 10%,
 * cost VAT 10%, cargo and service-fee VAT 20%. VAT amounts come from `vatFromGross`
 * and stoppage from `stoppageAmount(netSaleStoppageBase(...), 1%)`, so the tax module
 * is exercised end to end. COST_COGS lines are seller-entered actuals.
 */
function melontikOrderLines(): ProfitLine[] {
  const saleAVat = vatText('491.28', SALE_VAT_RATE);
  const saleBVat = vatText('380.47', SALE_VAT_RATE);
  return [
    makeLine({ type: ProfitLineType.SALE, gross: '491.28', vat: saleAVat, orderItemId: 'item-a' }),
    makeLine({ type: ProfitLineType.SALE, gross: '380.47', vat: saleBVat, orderItemId: 'item-b' }),
    makeLine({
      type: ProfitLineType.COST_COGS,
      gross: '233.00',
      vat: vatText('233.00', COST_VAT_RATE),
      orderItemId: 'item-a',
      certainty: ProfitLineCertainty.ACTUAL,
      source: ProfitLineSource.SELLER_INPUT,
    }),
    makeLine({
      type: ProfitLineType.COST_COGS,
      gross: '165.00',
      vat: vatText('165.00', COST_VAT_RATE),
      orderItemId: 'item-b',
      certainty: ProfitLineCertainty.ACTUAL,
      source: ProfitLineSource.SELLER_INPUT,
    }),
    makeLine({
      type: ProfitLineType.COMMISSION,
      gross: '93.34',
      vat: vatText('93.34', FEE_VAT_RATE),
      orderItemId: 'item-a',
    }),
    makeLine({
      type: ProfitLineType.COMMISSION,
      gross: '72.29',
      vat: vatText('72.29', FEE_VAT_RATE),
      orderItemId: 'item-b',
    }),
    makeLine({
      type: ProfitLineType.SHIPPING,
      gross: '98.34',
      vat: vatText('98.34', FEE_VAT_RATE),
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
    }),
    makeLine({
      type: ProfitLineType.SERVICE_FEE,
      gross: '13.19',
      vat: vatText('13.19', FEE_VAT_RATE),
      level: ProfitLineLevel.PARCEL,
      orderItemId: null,
    }),
    makeLine({
      type: ProfitLineType.STOPPAGE,
      gross: stoppageText('491.28', saleAVat),
      orderItemId: 'item-a',
    }),
    makeLine({
      type: ProfitLineType.STOPPAGE,
      gross: stoppageText('380.47', saleBVat),
      orderItemId: 'item-b',
    }),
  ];
}

describe('golden: melontik order 11761487239', () => {
  it('reproduces 191.79 when negative net VAT is included', () => {
    const s = computeProfitStatement({
      lines: melontikOrderLines(),
      view: 'BEST_KNOWN',
      settings: { includeStopaj: true, includeNegativeNetVat: true },
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: [],
    });
    expect(s.saleGross.toFixed(2)).toBe('871.75');
    expect(s.costGross.toFixed(2)).toBe('398.00');
    expect(s.vat.output.toFixed(2)).toBe('79.25');
    expect(s.vat.input.toFixed(2)).toBe('82.38');
    expect(s.vat.effective.toFixed(2)).toBe('-3.13');
    expect(s.stoppageGross.toFixed(2)).toBe('7.93');
    expect(s.netProfit?.toFixed(2)).toBe('191.79');
    expect(s.saleMarginPct?.toFixed(2)).toBe('22.00');
    expect(s.costMarkupPct?.toFixed(2)).toBe('48.19');
    expect(s.status).toBe(ProfitStatus.ESTIMATED);
  });

  it('clamps to 188.66 with the default setting', () => {
    const s = computeProfitStatement({
      lines: melontikOrderLines(),
      view: 'BEST_KNOWN',
      settings: { includeStopaj: true, includeNegativeNetVat: false },
      isExportSale: false,
      isCancelled: false,
      isExcluded: false,
      issues: [],
    });
    expect(s.vat.effective.toFixed(2)).toBe('0.00');
    expect(s.netProfit?.toFixed(2)).toBe('188.66');
  });
});
