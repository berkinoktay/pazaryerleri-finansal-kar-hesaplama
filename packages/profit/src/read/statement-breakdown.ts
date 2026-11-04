import { Decimal } from 'decimal.js';
import { type Prisma } from '@pazarsync/db';
import { ProfitLineType } from '@pazarsync/db/enums';

import { getLineSpec, type ProfitLineGroup } from '../core/catalog/profit-line-catalog';
import { type ProfitLine } from '../core/profit-line';
import { type ProfitStatement } from '../core/profit-statement';
import { roundPercent } from '../money';

const ZERO = new Decimal(0);

/**
 * The statement totals the order breakdown needs, decoupled from how they were
 * produced: the two margins already rounded to the stored column scale so a
 * breakdown built from a live computation and one read back from the stored row
 * render the same strings. Amounts are kurus (two decimals); margins keep four.
 */
export interface StatementTotals {
  readonly saleGross: Decimal;
  readonly vatOutput: Decimal;
  readonly costGross: Decimal;
  readonly vatEffective: Decimal;
  readonly stoppageGross: Decimal;
  readonly stoppageIncluded: boolean;
  readonly netProfit: Decimal | null;
  readonly saleMarginPct: Decimal | null;
  readonly costMarkupPct: Decimal | null;
}

/** The order_profit_statements columns the totals are read from. */
export const STORED_STATEMENT_TOTALS_SELECT = {
  saleGross: true,
  vatOutput: true,
  costGross: true,
  vatEffective: true,
  stoppageGross: true,
  stoppageIncluded: true,
  netProfit: true,
  saleMarginPct: true,
  costMarkupPct: true,
} as const satisfies Prisma.OrderProfitStatementSelect;

/** An order_profit_statements row projected through STORED_STATEMENT_TOTALS_SELECT. */
export type StoredStatementTotalsRow = Prisma.OrderProfitStatementGetPayload<{
  select: typeof STORED_STATEMENT_TOTALS_SELECT;
}>;

/** Reads the totals back from a stored statement row, decimals as decimal.js values. */
export function statementTotalsFromRow(row: StoredStatementTotalsRow): StatementTotals {
  return {
    saleGross: new Decimal(row.saleGross.toString()),
    vatOutput: new Decimal(row.vatOutput.toString()),
    costGross: new Decimal(row.costGross.toString()),
    vatEffective: new Decimal(row.vatEffective.toString()),
    stoppageGross: new Decimal(row.stoppageGross.toString()),
    stoppageIncluded: row.stoppageIncluded,
    netProfit: row.netProfit === null ? null : new Decimal(row.netProfit.toString()),
    saleMarginPct: row.saleMarginPct === null ? null : new Decimal(row.saleMarginPct.toString()),
    costMarkupPct: row.costMarkupPct === null ? null : new Decimal(row.costMarkupPct.toString()),
  };
}

/**
 * Reads the totals out of an in-request statement computation. The two margins are
 * rounded to the stored column scale (four decimals, half-up) exactly as the writer
 * persists them, so a breakdown from this path matches one from `statementTotalsFromRow`
 * with no double-rounding drift.
 */
export function statementTotalsFromStatement(statement: ProfitStatement): StatementTotals {
  return {
    saleGross: statement.saleGross,
    vatOutput: statement.vat.output,
    costGross: statement.costGross,
    vatEffective: statement.vat.effective,
    stoppageGross: statement.stoppageGross,
    stoppageIncluded: statement.stoppageIncluded,
    netProfit: statement.netProfit,
    saleMarginPct: statement.saleMarginPct === null ? null : roundPercent(statement.saleMarginPct),
    costMarkupPct: statement.costMarkupPct === null ? null : roundPercent(statement.costMarkupPct),
  };
}

/**
 * The order profit breakdown on the wire (matches the API's ProfitBreakdownSchema):
 * every amount a two-decimal string and the two margins a two-decimal string or null.
 */
export interface StatementBreakdown {
  readonly listGross: string;
  readonly sellerDiscountGross: string;
  readonly saleGross: string;
  readonly saleVat: string;
  readonly costGross: string;
  readonly costVat: string;
  readonly commissionGross: string;
  readonly commissionVat: string;
  readonly shippingGross: string;
  readonly shippingVat: string;
  readonly outboundShippingGross: string;
  readonly outboundShippingVat: string;
  readonly returnShippingGross: string;
  readonly returnShippingVat: string;
  readonly platformServiceGross: string;
  readonly platformServiceVat: string;
  readonly internationalServiceGross: string;
  readonly internationalServiceVat: string;
  readonly overseasReturnOperationGross: string;
  readonly overseasReturnOperationVat: string;
  readonly stoppage: string;
  readonly netVat: string;
  readonly netProfit: string;
  readonly saleMarginPct: string | null;
  readonly costMarkupPct: string | null;
  readonly marketplaceFeesGross: string;
  readonly taxesGross: string;
  readonly totalDeductionsGross: string;
}

/** Sum of the gross amounts of every selected line of one type (unsigned). */
function grossOf(lines: readonly ProfitLine[], type: ProfitLineType): Decimal {
  return lines.reduce((sum, line) => (line.type === type ? sum.add(line.amount.gross) : sum), ZERO);
}

/** Sum of the VAT amounts of every selected line of one type (unsigned). */
function vatOf(lines: readonly ProfitLine[], type: ProfitLineType): Decimal {
  return lines.reduce((sum, line) => (line.type === type ? sum.add(line.amount.vat) : sum), ZERO);
}

/** Signed gross over a whole layout group: income adds, expense subtracts. */
function signedGrossOfGroup(lines: readonly ProfitLine[], group: ProfitLineGroup): Decimal {
  return lines.reduce((sum, line) => {
    const spec = getLineSpec(line.type);
    if (spec.group !== group) {
      return sum;
    }
    return spec.direction === 'INCOME' ? sum.add(line.amount.gross) : sum.sub(line.amount.gross);
  }, ZERO);
}

/** Input (deductible) VAT over a group: expense adds, income (e.g. a return) subtracts. */
function inputVatOfGroup(lines: readonly ProfitLine[], group: ProfitLineGroup): Decimal {
  return lines.reduce((sum, line) => {
    const spec = getLineSpec(line.type);
    if (spec.group !== group) {
      return sum;
    }
    return spec.direction === 'EXPENSE' ? sum.add(line.amount.vat) : sum.sub(line.amount.vat);
  }, ZERO);
}

/** A kurus amount as a two-decimal string (half-up), with signed zero normalized. */
function money(value: Decimal): string {
  const fixed = value.toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed === '-0.00' ? '0.00' : fixed;
}

/** A margin as a two-decimal string (half-up), or null. */
function percent(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed(2, Decimal.ROUND_HALF_UP);
}

/**
 * Builds the order profit breakdown from a statement's totals and its selected lines.
 * Returns null when the statement carries no net profit (not computable or excluded).
 *
 * Group membership and direction come from the catalog (`getLineSpec`), never from a
 * hard-coded type list, so a new line type is placed by its spec. The four display
 * groups close to the sale to the kurus: cost + marketplace fees + taxes + net profit
 * equals the sale gross, which the golden tests assert.
 */
export function buildStatementBreakdown(input: {
  readonly totals: StatementTotals;
  readonly selectedLines: readonly ProfitLine[];
  readonly listGross: Decimal;
  readonly sellerDiscountGross: Decimal;
}): StatementBreakdown | null {
  const { totals, selectedLines, listGross, sellerDiscountGross } = input;
  if (totals.netProfit === null) {
    return null;
  }

  // Product cost plus the seller's own per-order expense; their input VAT together.
  const costGross = totals.costGross.add(
    grossOf(selectedLines, ProfitLineType.SELLER_ORDER_EXPENSE),
  );
  const costVat = inputVatOfGroup(selectedLines, 'PRODUCT_COST').add(
    inputVatOfGroup(selectedLines, 'SELLER_EXPENSE'),
  );

  const commissionGross = grossOf(selectedLines, ProfitLineType.COMMISSION).sub(
    grossOf(selectedLines, ProfitLineType.COMMISSION_REFUND),
  );
  const commissionVat = vatOf(selectedLines, ProfitLineType.COMMISSION).sub(
    vatOf(selectedLines, ProfitLineType.COMMISSION_REFUND),
  );

  const outboundShippingGross = grossOf(selectedLines, ProfitLineType.SHIPPING);
  const outboundShippingVat = vatOf(selectedLines, ProfitLineType.SHIPPING);
  const returnShippingGross = grossOf(selectedLines, ProfitLineType.RETURN_SHIPPING);
  const returnShippingVat = vatOf(selectedLines, ProfitLineType.RETURN_SHIPPING);
  const shippingGross = outboundShippingGross.add(returnShippingGross);
  const shippingVat = outboundShippingVat.add(returnShippingVat);

  const platformServiceGross = grossOf(selectedLines, ProfitLineType.SERVICE_FEE);
  const platformServiceVat = vatOf(selectedLines, ProfitLineType.SERVICE_FEE);
  const internationalServiceGross = grossOf(
    selectedLines,
    ProfitLineType.INTERNATIONAL_SERVICE_FEE,
  );
  const internationalServiceVat = vatOf(selectedLines, ProfitLineType.INTERNATIONAL_SERVICE_FEE);
  const overseasReturnOperationGross = grossOf(
    selectedLines,
    ProfitLineType.INTERNATIONAL_OPERATION_FEE,
  );
  const overseasReturnOperationVat = vatOf(
    selectedLines,
    ProfitLineType.INTERNATIONAL_OPERATION_FEE,
  );

  const stoppage = totals.stoppageIncluded ? totals.stoppageGross : ZERO;
  const netVat = totals.vatEffective;

  // Every marketplace charge (commission, shipping, PSF, micro fees, penalties,
  // adjustments) nets into one group, less the discount the marketplace funded.
  const marketplaceFeesGross = signedGrossOfGroup(selectedLines, 'MARKETPLACE_FEE')
    .negated()
    .sub(grossOf(selectedLines, ProfitLineType.MARKETPLACE_DISCOUNT_CONTRIBUTION));
  const taxesGross = stoppage.add(netVat);
  const totalDeductionsGross = costGross.add(marketplaceFeesGross).add(taxesGross);

  return {
    listGross: money(listGross),
    sellerDiscountGross: money(sellerDiscountGross),
    saleGross: money(totals.saleGross),
    saleVat: money(totals.vatOutput),
    costGross: money(costGross),
    costVat: money(costVat),
    commissionGross: money(commissionGross),
    commissionVat: money(commissionVat),
    shippingGross: money(shippingGross),
    shippingVat: money(shippingVat),
    outboundShippingGross: money(outboundShippingGross),
    outboundShippingVat: money(outboundShippingVat),
    returnShippingGross: money(returnShippingGross),
    returnShippingVat: money(returnShippingVat),
    platformServiceGross: money(platformServiceGross),
    platformServiceVat: money(platformServiceVat),
    internationalServiceGross: money(internationalServiceGross),
    internationalServiceVat: money(internationalServiceVat),
    overseasReturnOperationGross: money(overseasReturnOperationGross),
    overseasReturnOperationVat: money(overseasReturnOperationVat),
    stoppage: money(stoppage),
    netVat: money(netVat),
    netProfit: money(totals.netProfit),
    saleMarginPct: percent(totals.saleMarginPct),
    costMarkupPct: percent(totals.costMarkupPct),
    marketplaceFeesGross: money(marketplaceFeesGross),
    taxesGross: money(taxesGross),
    totalDeductionsGross: money(totalDeductionsGross),
  };
}
