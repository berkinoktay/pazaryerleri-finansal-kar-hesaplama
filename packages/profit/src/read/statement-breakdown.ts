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

/** The four display buckets the catalog groups fold into for the order breakdown. */
type BreakdownFold = 'SALE' | 'COST' | 'MARKETPLACE' | 'TAX';

/**
 * Which display bucket each catalog group folds into. Typed as a total `Record` over
 * `ProfitLineGroup`, so adding a group to the catalog is a compile error here until it
 * is placed -- that is what keeps the four-group closure (cost + marketplace + taxes +
 * net === sale) honest as the catalog grows, instead of a hard-coded list of the line
 * types that happen to exist today.
 */
const BREAKDOWN_GROUP_FOLD: Readonly<Record<ProfitLineGroup, BreakdownFold>> = {
  REVENUE: 'SALE',
  PRODUCT_COST: 'COST',
  SELLER_EXPENSE: 'COST',
  MARKETPLACE_FEE: 'MARKETPLACE',
  TAX: 'TAX',
};

interface SignedAmount {
  readonly gross: Decimal;
  readonly vat: Decimal;
}

/**
 * Folds every selected line's gross and VAT into the four display buckets by its catalog
 * group and direction: income adds, expense subtracts. The caller flips the cost and
 * marketplace signs for display (both read as deductions from the sale).
 */
function foldByGroup(lines: readonly ProfitLine[]): Record<BreakdownFold, SignedAmount> {
  const folds: Record<BreakdownFold, SignedAmount> = {
    SALE: { gross: ZERO, vat: ZERO },
    COST: { gross: ZERO, vat: ZERO },
    MARKETPLACE: { gross: ZERO, vat: ZERO },
    TAX: { gross: ZERO, vat: ZERO },
  };
  for (const line of lines) {
    const spec = getLineSpec(line.type);
    const fold = BREAKDOWN_GROUP_FOLD[spec.group];
    const current = folds[fold];
    const isIncome = spec.direction === 'INCOME';
    folds[fold] = {
      gross: isIncome ? current.gross.add(line.amount.gross) : current.gross.sub(line.amount.gross),
      vat: isIncome ? current.vat.add(line.amount.vat) : current.vat.sub(line.amount.vat),
    };
  }
  return folds;
}

/** A kurus amount as a two-decimal string (half-up), with signed zero normalized. */
function money(value: Decimal): string {
  const fixed = value.toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed === '-0.00' ? '0.00' : fixed;
}

/** A margin as a two-decimal string (half-up) with signed zero normalized, or null. */
function percent(value: Decimal | null): string | null {
  if (value === null) {
    return null;
  }
  const fixed = value.toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed === '-0.00' ? '0.00' : fixed;
}

/**
 * Builds the order profit breakdown from a statement's totals and its selected lines.
 * Returns null when the statement carries no net profit (not computable or excluded).
 *
 * The four display groups fold from the catalog: each line's catalog group maps to a
 * display bucket through `BREAKDOWN_GROUP_FOLD` and its direction gives the sign, so a
 * new line type -- or a whole new group -- is placed by its spec, never by a hard-coded
 * type list. That keeps the closure honest: cost + marketplace fees + taxes + net profit
 * equals the sale gross to the kurus (the golden tests assert it). The individual fee
 * rows below (commission, shipping, service fees, stoppage) are still summed per type,
 * because each is a named line on screen rather than a whole group.
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

  const folds = foldByGroup(selectedLines);

  // The shown sale is SALE - SALE_RETURN (`totals.saleGross`); its VAT is the VAT inside
  // that, never the revenue group's output VAT, which would also carry the VAT of a
  // discount contribution. Any other REVENUE income is a surplus over the shown sale --
  // today only a marketplace-funded discount contribution -- credited to the fees below.
  const revenueSurplus = folds.SALE.gross.sub(totals.saleGross);
  const saleVat = vatOf(selectedLines, ProfitLineType.SALE).sub(
    vatOf(selectedLines, ProfitLineType.SALE_RETURN),
  );

  // Product cost plus the seller's own per-order expense fold into one deduction, their
  // input VAT with them; the COST-fold groups give the sign, not a per-type list.
  const costGross = folds.COST.gross.negated();
  const costVat = folds.COST.vat.negated();

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
  // adjustments) nets into one deduction, less the revenue surplus the marketplace
  // funded. The MARKETPLACE fold carries whatever types the catalog places there, so a
  // new fee type lands here with no code change.
  const marketplaceFeesGross = folds.MARKETPLACE.gross.negated().sub(revenueSurplus);
  const taxesGross = stoppage.add(netVat);
  const totalDeductionsGross = costGross.add(marketplaceFeesGross).add(taxesGross);

  return {
    listGross: money(listGross),
    sellerDiscountGross: money(sellerDiscountGross),
    saleGross: money(totals.saleGross),
    saleVat: money(saleVat),
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
