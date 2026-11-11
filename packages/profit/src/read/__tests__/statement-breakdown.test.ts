import { Decimal } from 'decimal.js';
import { Prisma } from '@pazarsync/db';
import {
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatementView,
  ProfitStatus,
  ReconciliationStatus,
} from '@pazarsync/db/enums';
import { type ResolvedProfitSettings } from '@pazarsync/utils';
import { describe, expect, it } from 'vitest';

import { PROFIT_ENGINE_VERSION } from '../../core/engine-version';
import { createProfitLine, type ProfitLine } from '../../core/profit-line';
import { computeProfitStatement, type ProfitStatement } from '../../core/profit-statement';
import { roundPercent } from '../../money';
import { makeLine } from '../../__tests__/helpers/make-profit-line';
import {
  buildStatementBreakdown,
  statementTotalsFromRow,
  statementTotalsFromStatement,
  type StatementBreakdown,
  type StatementTotals,
  type StoredStatementTotalsRow,
} from '../statement-breakdown';

const WITH_STOPPAGE: ResolvedProfitSettings = { includeStopaj: true, includeNegativeNetVat: true };
const WITHOUT_STOPPAGE: ResolvedProfitSettings = {
  includeStopaj: false,
  includeNegativeNetVat: true,
};

/** Builds a best-known statement from a set of lines under the given flags. */
function statementOf(
  lines: readonly ProfitLine[],
  flags: {
    readonly settings?: ResolvedProfitSettings;
    readonly isExportSale?: boolean;
    readonly isCancelled?: boolean;
    readonly isExcluded?: boolean;
  } = {},
): ProfitStatement {
  return computeProfitStatement({
    lines,
    view: ProfitStatementView.BEST_KNOWN,
    settings: flags.settings ?? WITH_STOPPAGE,
    isExportSale: flags.isExportSale ?? false,
    isCancelled: flags.isCancelled ?? false,
    isExcluded: flags.isExcluded ?? false,
    issues: [],
  });
}

/** Builds the breakdown from a statement, failing the test when it is unexpectedly null. */
function breakdownOf(statement: ProfitStatement): StatementBreakdown {
  const breakdown = buildStatementBreakdown({
    totals: statementTotalsFromStatement(statement),
    selectedLines: statement.selectedLines,
  });
  if (breakdown === null) {
    throw new Error('expected a breakdown, got null');
  }
  return breakdown;
}

/** The four display groups must close to the sale gross to the kurus. */
function expectClosesToSale(breakdown: StatementBreakdown): void {
  const sum = new Decimal(breakdown.costGross)
    .add(breakdown.marketplaceFeesGross)
    .add(breakdown.taxesGross)
    .add(breakdown.netProfit);
  expect(sum.toFixed(2)).toBe(breakdown.saleGross);
}

const TWO_DECIMALS = /^-?\d+\.\d{2}$/;

/** A SALE line for one item, optionally carrying the engine's list/discount inputs. */
function saleLine(params: {
  readonly orderItemId: string;
  readonly gross: string;
  readonly listGross?: string;
  readonly sellerDiscountGross?: string;
}): ProfitLine {
  const inputs: Record<string, string> = {};
  if (params.listGross !== undefined) {
    inputs['listGross'] = params.listGross;
  }
  if (params.sellerDiscountGross !== undefined) {
    inputs['sellerDiscountGross'] = params.sellerDiscountGross;
  }
  return createProfitLine({
    type: ProfitLineType.SALE,
    level: ProfitLineLevel.ITEM,
    orderItemId: params.orderItemId,
    certainty: ProfitLineCertainty.ESTIMATE,
    source: ProfitLineSource.RULE,
    amount: { gross: new Decimal(params.gross), vat: new Decimal('0') },
    vatRatePct: null,
    inputs,
    externalRecord: null,
  });
}

/** The list price less the seller discount must equal the shown sale to the kurus. */
function expectListLessDiscountIsSale(breakdown: StatementBreakdown): void {
  expect(new Decimal(breakdown.listGross).sub(breakdown.sellerDiscountGross).toFixed(2)).toBe(
    breakdown.saleGross,
  );
}

describe('buildStatementBreakdown income lines', () => {
  it('derives list price and discount from the sale lines', () => {
    const breakdown = breakdownOf(
      statementOf([
        saleLine({
          orderItemId: 'item-1',
          gross: '399.00',
          listGross: '420.00',
          sellerDiscountGross: '21.00',
        }),
        saleLine({
          orderItemId: 'item-2',
          gross: '140.00',
          listGross: '140.00',
          sellerDiscountGross: '0.00',
        }),
      ]),
    );

    expect(breakdown.listGross).toBe('560.00');
    expect(breakdown.sellerDiscountGross).toBe('21.00');
    expect(breakdown.saleGross).toBe('539.00');
    expectListLessDiscountIsSale(breakdown);
  });

  it('nets a returned item out of the list price and discount', () => {
    const breakdown = breakdownOf(
      statementOf([
        saleLine({
          orderItemId: 'item-1',
          gross: '399.00',
          listGross: '420.00',
          sellerDiscountGross: '21.00',
        }),
        makeLine({ type: ProfitLineType.SALE_RETURN, orderItemId: 'item-1', gross: '399.00' }),
        saleLine({
          orderItemId: 'item-2',
          gross: '140.00',
          listGross: '140.00',
          sellerDiscountGross: '0.00',
        }),
      ]),
    );

    expect(breakdown.listGross).toBe('140.00');
    expect(breakdown.sellerDiscountGross).toBe('0.00');
    expect(breakdown.saleGross).toBe('140.00');
    expectListLessDiscountIsSale(breakdown);
  });

  it('keeps the unreturned share of a partly returned item', () => {
    // Two units at 210 list / 10.50 discount each; one unit comes back.
    const breakdown = breakdownOf(
      statementOf([
        saleLine({
          orderItemId: 'item-1',
          gross: '399.00',
          listGross: '420.00',
          sellerDiscountGross: '21.00',
        }),
        makeLine({ type: ProfitLineType.SALE_RETURN, orderItemId: 'item-1', gross: '199.50' }),
      ]),
    );

    expect(breakdown.listGross).toBe('210.00');
    expect(breakdown.sellerDiscountGross).toBe('10.50');
    expect(breakdown.saleGross).toBe('199.50');
    expectListLessDiscountIsSale(breakdown);
  });

  it('reads a sale line without list inputs as list price with no discount', () => {
    const breakdown = breakdownOf(
      statementOf([saleLine({ orderItemId: 'item-1', gross: '100.00' })]),
    );

    expect(breakdown.listGross).toBe('100.00');
    expect(breakdown.sellerDiscountGross).toBe('0.00');
    expectListLessDiscountIsSale(breakdown);
  });

  it('shows no list price and no discount for a cancelled order', () => {
    const breakdown = breakdownOf(statementOf([], { isCancelled: true }));

    expect(breakdown.listGross).toBe('0.00');
    expect(breakdown.sellerDiscountGross).toBe('0.00');
    expect(breakdown.saleGross).toBe('0.00');
  });
});

describe('buildStatementBreakdown', () => {
  it('closes the four groups to the sale to the kurus', () => {
    const plainSale = [
      makeLine({ type: ProfitLineType.SALE, gross: '491.28', vat: '44.66' }),
      makeLine({ type: ProfitLineType.COST_COGS, gross: '233.00', vat: '21.18' }),
      makeLine({ type: ProfitLineType.COMMISSION, gross: '93.34', vat: '15.56' }),
      makeLine({ type: ProfitLineType.SHIPPING, gross: '49.17', vat: '8.20' }),
      makeLine({ type: ProfitLineType.SERVICE_FEE, gross: '13.19', vat: '2.20' }),
      makeLine({ type: ProfitLineType.STOPPAGE, gross: '4.91' }),
    ];
    const returnWithEveryLeg = [
      ...plainSale,
      makeLine({ type: ProfitLineType.SALE_RETURN, gross: '491.28', vat: '44.66' }),
      makeLine({ type: ProfitLineType.COMMISSION_REFUND, gross: '93.34', vat: '15.56' }),
      makeLine({ type: ProfitLineType.COST_RETURN, gross: '233.00', vat: '21.18' }),
      makeLine({ type: ProfitLineType.RETURN_SHIPPING, gross: '49.17', vat: '8.20' }),
      makeLine({ type: ProfitLineType.STOPPAGE_REFUND, gross: '4.91' }),
    ];
    const exportSale = [
      makeLine({ type: ProfitLineType.SALE, gross: '600.00', vat: '0' }),
      makeLine({ type: ProfitLineType.COST_COGS, gross: '200.00', vat: '18.18' }),
      makeLine({ type: ProfitLineType.COMMISSION, gross: '120.00', vat: '20.00' }),
      makeLine({ type: ProfitLineType.INTERNATIONAL_SERVICE_FEE, gross: '30.00', vat: '5.00' }),
      makeLine({ type: ProfitLineType.INTERNATIONAL_OPERATION_FEE, gross: '15.00', vat: '2.50' }),
    ];
    const withPenalty = [
      ...plainSale,
      makeLine({ type: ProfitLineType.PENALTY, gross: '7.50', vat: '1.25' }),
    ];
    const withDiscountContribution = [
      ...plainSale,
      makeLine({
        type: ProfitLineType.MARKETPLACE_DISCOUNT_CONTRIBUTION,
        gross: '20.00',
        vat: '1.82',
      }),
    ];
    const withSellerExpense = [
      ...plainSale,
      makeLine({ type: ProfitLineType.SELLER_ORDER_EXPENSE, gross: '12.00', vat: '2.00' }),
    ];

    const cases = [
      { name: 'a plain sale', statement: statementOf(plainSale) },
      { name: 'a return with every leg', statement: statementOf(returnWithEveryLeg) },
      { name: 'stoppage included', statement: statementOf(plainSale, { settings: WITH_STOPPAGE }) },
      {
        name: 'stoppage excluded',
        statement: statementOf(plainSale, {
          settings: { includeStopaj: false, includeNegativeNetVat: true },
        }),
      },
      { name: 'an export sale', statement: statementOf(exportSale, { isExportSale: true }) },
      { name: 'a penalty line', statement: statementOf(withPenalty) },
      { name: 'a discount contribution', statement: statementOf(withDiscountContribution) },
      { name: 'a seller order expense', statement: statementOf(withSellerExpense) },
    ] as const;

    for (const { name, statement } of cases) {
      const breakdown = breakdownOf(statement);
      expect(breakdown, name).toBeDefined();
      expectClosesToSale(breakdown);
    }

    // A penalty has no own row but still lands in the marketplace fees group: adding
    // it raises the group by its gross and keeps the closure.
    const withoutPenalty = breakdownOf(statementOf(plainSale));
    const penalised = breakdownOf(statementOf(withPenalty));
    expect(
      new Decimal(penalised.marketplaceFeesGross)
        .sub(withoutPenalty.marketplaceFeesGross)
        .toFixed(2),
    ).toBe('7.50');

    // The discount contribution is funded by the marketplace: it lowers the fees group
    // and never appears in the sale gross.
    const contributed = breakdownOf(statementOf(withDiscountContribution));
    expect(
      new Decimal(withoutPenalty.marketplaceFeesGross)
        .sub(contributed.marketplaceFeesGross)
        .toFixed(2),
    ).toBe('20.00');
    expect(contributed.saleGross).toBe(withoutPenalty.saleGross);

    // The seller order expense joins the product-cost group, not the fees group.
    const sellerExpensed = breakdownOf(statementOf(withSellerExpense));
    expect(new Decimal(sellerExpensed.costGross).sub(withoutPenalty.costGross).toFixed(2)).toBe(
      '12.00',
    );

    // Both shipping legs roll up into the total shipping row.
    const returned = breakdownOf(statementOf(returnWithEveryLeg));
    expect(returned.outboundShippingGross).toBe('49.17');
    expect(returned.returnShippingGross).toBe('49.17');
    expect(returned.shippingGross).toBe('98.34');

    // The export fees surface on their own rows.
    const exported = breakdownOf(statementOf(exportSale, { isExportSale: true }));
    expect(exported.internationalServiceGross).toBe('30.00');
    expect(exported.overseasReturnOperationGross).toBe('15.00');
  });

  it('closes the four groups to the sale for every line type in the catalog', () => {
    // One line of each catalog type, placed at a level the spec allows (makeLine reads
    // the catalog), on top of a plain sale. Whatever group the catalog puts the type in,
    // the four display groups still close to the sale -- with the stoppage both ways.
    for (const type of Object.values(ProfitLineType)) {
      const lines = [
        makeLine({ type: ProfitLineType.SALE, gross: '200.00', vat: '18.18' }),
        makeLine({ type, gross: '30.00', vat: '2.50' }),
      ];
      for (const settings of [WITH_STOPPAGE, WITHOUT_STOPPAGE] as const) {
        const breakdown = breakdownOf(statementOf(lines, { settings }));
        expectClosesToSale(breakdown);
      }
    }
  });

  it("keeps a discount contribution's VAT out of the sale VAT", () => {
    const breakdown = breakdownOf(
      statementOf([
        makeLine({ type: ProfitLineType.SALE, gross: '100.00', vat: '9.09' }),
        makeLine({
          type: ProfitLineType.MARKETPLACE_DISCOUNT_CONTRIBUTION,
          gross: '20.00',
          vat: '1.82',
        }),
      ]),
    );

    // The sale VAT is the VAT inside the shown sale (9.09), not the revenue group's
    // output VAT, which would also carry the discount contribution's 1.82.
    expect(breakdown.saleVat).toBe('9.09');
    expect(breakdown.saleGross).toBe('100.00');
    expectClosesToSale(breakdown);
  });

  it('never writes a negative zero margin', () => {
    // A margin that rounds to "-0.00" at two decimals must render as a plain "0.00",
    // exactly as the money formatter normalizes its own signed zero.
    const totals: StatementTotals = {
      saleGross: new Decimal('100.00'),
      vatOutput: new Decimal('0'),
      costGross: new Decimal('0'),
      vatEffective: new Decimal('0'),
      stoppageGross: new Decimal('0'),
      stoppageIncluded: false,
      netProfit: new Decimal('0.00'),
      saleMarginPct: new Decimal('-0.004'),
      costMarkupPct: new Decimal('-0.004'),
    };
    const breakdown = buildStatementBreakdown({
      totals,
      selectedLines: [],
    });

    expect(breakdown?.saleMarginPct).toBe('0.00');
    expect(breakdown?.costMarkupPct).toBe('0.00');
  });

  it('writes four-decimal margins when asked', () => {
    // The stored margins are numeric(12,4); a quote screen renders them at full
    // precision, while an order keeps the default two decimals. A four-decimal
    // negative zero normalizes just like the two-decimal one.
    const totals: StatementTotals = {
      saleGross: new Decimal('100.00'),
      vatOutput: new Decimal('0'),
      costGross: new Decimal('80.00'),
      vatEffective: new Decimal('0'),
      stoppageGross: new Decimal('0'),
      stoppageIncluded: false,
      netProfit: new Decimal('12.3456'),
      saleMarginPct: new Decimal('12.3456'),
      costMarkupPct: new Decimal('-0.00004'),
    };

    const four = buildStatementBreakdown({
      totals,
      selectedLines: [],
      marginDecimals: 4,
    });
    expect(four?.saleMarginPct).toBe('12.3456');
    expect(four?.costMarkupPct).toBe('0.0000');

    const two = buildStatementBreakdown({
      totals,
      selectedLines: [],
    });
    expect(two?.saleMarginPct).toBe('12.35');
    expect(two?.costMarkupPct).toBe('0.00');
  });

  it('writes every amount with two decimals', () => {
    const breakdown = breakdownOf(
      statementOf([
        makeLine({ type: ProfitLineType.SALE, gross: '100.00', vat: '9.09' }),
        makeLine({ type: ProfitLineType.COMMISSION, gross: '20.00', vat: '3.33' }),
      ]),
    );

    for (const [field, value] of Object.entries(breakdown)) {
      if (field === 'saleMarginPct' || field === 'costMarkupPct') {
        continue;
      }
      expect(value, field).toMatch(TWO_DECIMALS);
    }

    // Types with no line render an exact zero, never a bare "0" or an empty string.
    expect(breakdown.returnShippingGross).toBe('0.00');
    expect(breakdown.internationalServiceGross).toBe('0.00');
    expect(breakdown.overseasReturnOperationGross).toBe('0.00');
    expect(breakdown.platformServiceGross).toBe('0.00');
  });

  it('returns null when the statement carries no net profit', () => {
    const statement = statementOf(
      [makeLine({ type: ProfitLineType.SALE, gross: '100.00', vat: '9.09' })],
      { isExcluded: true },
    );
    expect(statement.netProfit).toBeNull();
    expect(
      buildStatementBreakdown({
        totals: statementTotalsFromStatement(statement),
        selectedLines: statement.selectedLines,
      }),
    ).toBeNull();
  });

  it('shows the stoppage only when the statement includes it', () => {
    const lines = [
      makeLine({ type: ProfitLineType.SALE, gross: '200.00', vat: '18.18' }),
      makeLine({ type: ProfitLineType.STOPPAGE, gross: '2.00' }),
    ];
    const included = breakdownOf(statementOf(lines, { settings: WITH_STOPPAGE }));
    const excluded = breakdownOf(
      statementOf(lines, { settings: { includeStopaj: false, includeNegativeNetVat: true } }),
    );

    expect(included.stoppage).toBe('2.00');
    expect(excluded.stoppage).toBe('0.00');
    expectClosesToSale(included);
    expectClosesToSale(excluded);
  });

  it('rounds margins like the stored statement', () => {
    // A margin whose direct two-decimal rounding ("12.34") differs from rounding to
    // the stored four decimals first and then to two ("12.35"). The row path and the
    // statement path must both take the stored route.
    const rawMargin = new Decimal('12.34495');
    expect(rawMargin.toFixed(2)).toBe('12.34');
    const storedMargin = roundPercent(rawMargin);
    expect(storedMargin.toFixed(2)).toBe('12.35');

    const statement: ProfitStatement = {
      view: ProfitStatementView.BEST_KNOWN,
      status: ProfitStatus.ESTIMATED,
      reconciliationStatus: ReconciliationStatus.NOT_SETTLED,
      engineVersion: PROFIT_ENGINE_VERSION,
      selectedLines: [],
      rows: [],
      saleGross: new Decimal('100.00'),
      costGross: new Decimal('0.00'),
      vat: {
        output: new Decimal(0),
        input: new Decimal(0),
        net: new Decimal(0),
        effective: new Decimal(0),
      },
      stoppageGross: new Decimal(0),
      stoppageIncluded: false,
      netProfit: new Decimal('100.00'),
      saleMarginPct: rawMargin,
      costMarkupPct: rawMargin,
      issues: [],
    };

    const row: StoredStatementTotalsRow = {
      saleGross: new Prisma.Decimal('100.00'),
      vatOutput: new Prisma.Decimal('0'),
      costGross: new Prisma.Decimal('0'),
      vatEffective: new Prisma.Decimal('0'),
      stoppageGross: new Prisma.Decimal('0'),
      stoppageIncluded: false,
      netProfit: new Prisma.Decimal('100.00'),
      saleMarginPct: new Prisma.Decimal(storedMargin.toFixed()),
      costMarkupPct: new Prisma.Decimal(storedMargin.toFixed()),
    };

    const fromStatement = buildStatementBreakdown({
      totals: statementTotalsFromStatement(statement),
      selectedLines: [],
    });
    const fromRow = buildStatementBreakdown({
      totals: statementTotalsFromRow(row),
      selectedLines: [],
    });

    expect(fromStatement?.saleMarginPct).toBe('12.35');
    expect(fromRow?.saleMarginPct).toBe('12.35');
    expect(fromStatement?.saleMarginPct).toBe(fromRow?.saleMarginPct);
    expect(fromStatement?.costMarkupPct).toBe(fromRow?.costMarkupPct);
  });
});
