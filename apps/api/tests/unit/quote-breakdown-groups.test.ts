import {
  computeProfitStatement,
  createProfitLine,
  type ProfitLine,
  type ProfitStatement,
} from '@pazarsync/profit';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatementView,
} from '@pazarsync/db/enums';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { quoteBreakdownFromStatement } from '@/services/product-pricing.service';

/**
 * The product-pricing QUOTE breakdown now comes from the shared engine: the solved
 * scenario statement is folded by `buildStatementBreakdown` (margins at four decimals)
 * and projected onto the `QuoteBreakdown` wire shape. These tests build a real
 * statement from profit lines and assert the four allocation groups (cost + marketplace
 * fees + taxes + net profit) close to the sale gross, so the "where the sale went" bar
 * renders without a gap -- the closure the quote breakdown has always guaranteed.
 *
 * `quoteBreakdownFromStatement` is the service's statement -> QuoteBreakdown mapper
 * (the same path the quote route runs). It is pure, so this stays a unit test.
 */

const WITH_STOPPAGE = { includeStopaj: true, includeNegativeNetVat: true } as const;

function makeLine(
  type: ProfitLineType,
  gross: string,
  vat: string,
  level: ProfitLineLevel,
): ProfitLine {
  return createProfitLine({
    type,
    level,
    orderItemId: level === ProfitLineLevel.ITEM ? 'scenario-item' : null,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount: { gross: new Decimal(gross), vat: new Decimal(vat) },
    vatRatePct: null,
    inputs: {},
    externalRecord: null,
  });
}

/** A plain sale statement: sale 450, cost 180, commission 85.50, shipping 34.70, PSF, stoppage. */
function plainSaleStatement(extra: readonly ProfitLine[] = []): ProfitStatement {
  const lines: ProfitLine[] = [
    makeLine(ProfitLineType.SALE, '450.00', '75.00', ProfitLineLevel.ITEM),
    makeLine(ProfitLineType.COST_COGS, '180.00', '30.00', ProfitLineLevel.ITEM),
    makeLine(ProfitLineType.COMMISSION, '85.50', '14.25', ProfitLineLevel.ITEM),
    makeLine(ProfitLineType.SHIPPING, '34.70', '5.78', ProfitLineLevel.PARCEL),
    makeLine(ProfitLineType.STOPPAGE, '5.00', '0', ProfitLineLevel.ITEM),
    ...extra,
  ];
  return computeProfitStatement({
    lines,
    view: ProfitStatementView.BEST_KNOWN,
    settings: WITH_STOPPAGE,
    isExportSale: false,
    isCancelled: false,
    isExcluded: false,
    issues: [],
  });
}

function quoteBreakdownOf(statement: ProfitStatement) {
  const breakdown = quoteBreakdownFromStatement({
    statement,
    listGross: new Decimal('500.00'),
    sellerDiscountGross: new Decimal('50.00'),
  });
  if (breakdown === null) throw new Error('expected a breakdown, got null');
  return breakdown;
}

describe('quote breakdown -- allocation group totals', () => {
  it('sums taxes as stoppage + net VAT', () => {
    // netVat = 75.00 - (30.00 + 14.25 + 5.78) = 24.97; + stoppage 5.00 = 29.97.
    expect(quoteBreakdownOf(plainSaleStatement()).taxesGross).toBe('29.97');
  });

  it('derives total deductions as cost + marketplace fees + taxes (= sale - net profit)', () => {
    const bd = quoteBreakdownOf(plainSaleStatement());
    expect(bd.totalDeductionsGross).toBe(new Decimal(bd.saleGross).sub(bd.netProfit).toFixed(2));
  });

  it('keeps the four groups closing to saleGross (bar has no gap)', () => {
    const bd = quoteBreakdownOf(plainSaleStatement());
    const sum = new Decimal(bd.costGross)
      .add(bd.marketplaceFeesGross)
      .add(bd.taxesGross)
      .add(bd.netProfit);
    expect(sum.toFixed(2)).toBe(bd.saleGross);
  });

  it('folds a fee without its own bucket (e.g. a penalty) into marketplace fees and still closes', () => {
    const base = quoteBreakdownOf(plainSaleStatement());
    const withPenalty = quoteBreakdownOf(
      plainSaleStatement([makeLine(ProfitLineType.PENALTY, '12.00', '0', ProfitLineLevel.PARCEL)]),
    );
    // The penalty has no named field but still lands in the marketplace-fees group.
    expect(
      new Decimal(withPenalty.marketplaceFeesGross).sub(base.marketplaceFeesGross).toFixed(2),
    ).toBe('12.00');
    const sum = new Decimal(withPenalty.costGross)
      .add(withPenalty.marketplaceFeesGross)
      .add(withPenalty.taxesGross)
      .add(withPenalty.netProfit);
    expect(sum.toFixed(2)).toBe(withPenalty.saleGross);
  });

  it('renders the two margins at four decimals (quote precision)', () => {
    const bd = quoteBreakdownOf(plainSaleStatement());
    expect(bd.saleMarginPct).toMatch(/^-?\d+\.\d{4}$/);
    expect(bd.costMarkupPct).toMatch(/^-?\d+\.\d{4}$/);
  });
});
