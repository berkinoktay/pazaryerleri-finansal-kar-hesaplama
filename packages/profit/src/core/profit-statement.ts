import { Decimal } from 'decimal.js';
import {
  ProfitLineType,
  type ProfitStatementView,
  ProfitStatus,
  type ReconciliationStatus,
} from '@pazarsync/db/enums';
import { type ResolvedProfitSettings } from '@pazarsync/utils';

import { getLineSpec, type ProfitLineGroup } from './catalog/profit-line-catalog';
import { PROFIT_ENGINE_VERSION } from './engine-version';
import { type ProfitIssue } from './profit-issue';
import { type ProfitLine } from './profit-line';
import { deriveProfitStatus, deriveReconciliationStatus } from './profit-status';
import { selectLines } from './select-lines';
import { computeVatTotals, effectiveNetVat, type VatTotals } from '../tax/tr/net-vat';

/** Which view of the lines the statement is built from (see `selectLines`). */
export type { ProfitStatementView };

export interface ProfitStatementInput {
  readonly lines: readonly ProfitLine[];
  readonly view: ProfitStatementView;
  readonly settings: ResolvedProfitSettings;
  readonly isExportSale: boolean;
  readonly isCancelled: boolean;
  readonly isExcluded: boolean;
  readonly issues: readonly ProfitIssue[];
}

export interface ProfitStatementRow {
  readonly type: ProfitLineType;
  readonly group: ProfitLineGroup;
  readonly signedGross: Decimal; // income +, expense -
  readonly includedInProfit: boolean; // in the TAX group this follows settings.includeStopaj
}

export interface ProfitStatement {
  readonly view: ProfitStatementView;
  readonly status: ProfitStatus;
  // How far the statement's selected lines have reconciled with the marketplace,
  // derived independently of the profit status (see `deriveReconciliationStatus`).
  readonly reconciliationStatus: ReconciliationStatus;
  readonly engineVersion: number;
  readonly selectedLines: readonly ProfitLine[];
  readonly rows: readonly ProfitStatementRow[];
  readonly saleGross: Decimal; // sum SALE - sum SALE_RETURN
  readonly costGross: Decimal; // sum PRODUCT_COST expenses - sum COST_RETURN
  readonly vat: VatTotals & { readonly effective: Decimal };
  readonly stoppageGross: Decimal; // sum STOPPAGE - sum STOPPAGE_REFUND (ignores settings)
  readonly stoppageIncluded: boolean;
  readonly netProfit: Decimal | null; // null when NOT_COMPUTABLE or EXCLUDED
  readonly saleMarginPct: Decimal | null;
  readonly costMarkupPct: Decimal | null;
  readonly issues: readonly ProfitIssue[];
}

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

/** Sum of the gross amounts of every selected line of one type (unsigned). */
function sumGrossByType(lines: readonly ProfitLine[], type: ProfitLineType): Decimal {
  let sum = ZERO;
  for (const line of lines) {
    if (line.type === type) {
      sum = sum.add(line.amount.gross);
    }
  }
  return sum;
}

/** Signed gross for one type: income adds, expense subtracts (direction is per type). */
function signedGrossByType(lines: readonly ProfitLine[], type: ProfitLineType): Decimal {
  const gross = sumGrossByType(lines, type);
  return getLineSpec(type).direction === 'INCOME' ? gross : gross.negated();
}

/**
 * One row per type present among the selected lines, in `ProfitLineType` enum order
 * (which matches the catalog order). `Object.values` keeps the values typed as the
 * enum; `Object.keys` would widen them to `string`.
 */
function buildRows(
  lines: readonly ProfitLine[],
  settings: ResolvedProfitSettings,
): ProfitStatementRow[] {
  const rows: ProfitStatementRow[] = [];
  for (const type of Object.values(ProfitLineType)) {
    const spec = getLineSpec(type);
    if (!lines.some((line) => line.type === type)) {
      continue;
    }
    rows.push({
      type,
      group: spec.group,
      signedGross: signedGrossByType(lines, type),
      includedInProfit: spec.group !== 'TAX' || settings.includeStopaj,
    });
  }
  return rows;
}

/** Signed gross summed over the PRODUCT_COST group: expenses add, COST_RETURN subtracts. */
function costGrossOf(lines: readonly ProfitLine[]): Decimal {
  let cost = ZERO;
  for (const line of lines) {
    const spec = getLineSpec(line.type);
    if (spec.group !== 'PRODUCT_COST') {
      continue;
    }
    cost = spec.direction === 'EXPENSE' ? cost.add(line.amount.gross) : cost.sub(line.amount.gross);
  }
  return cost;
}

/** A ratio in percent, or null when the profit is unknown or the base is zero. Never rounded. */
function ratioPct(numerator: Decimal | null, base: Decimal): Decimal | null {
  if (numerator === null || base.isZero()) {
    return null;
  }
  return numerator.div(base).mul(HUNDRED);
}

/**
 * The profit statement: the single marketplace-agnostic profit computation. It picks
 * the lines for the requested view, aggregates them into per-type rows, derives the
 * net VAT and the status, and turns those into a net profit and its margins. Nothing
 * is re-rounded here; rows sum already-rounded line amounts and ratios stay unrounded.
 *
 * Two statuses leave the net profit and both margins empty: NOT_COMPUTABLE, which has
 * no trustworthy total to report, and EXCLUDED, whose order is permanently kept out of
 * every net profit figure (Berkin 2026-11-03) because its cost missed the order day.
 * Either way the revenue and the other totals (sale, cost, VAT, stoppage) still compute.
 */
export function computeProfitStatement(input: ProfitStatementInput): ProfitStatement {
  const selectedLines = selectLines(input.lines, input.view);
  const rows = buildRows(selectedLines, input.settings);

  const vatTotals = computeVatTotals(selectedLines);
  const effective = effectiveNetVat(vatTotals.net, {
    includeNegativeNetVat: input.settings.includeNegativeNetVat,
    isExportSale: input.isExportSale,
  });

  const saleGross = sumGrossByType(selectedLines, ProfitLineType.SALE).sub(
    sumGrossByType(selectedLines, ProfitLineType.SALE_RETURN),
  );
  const costGross = costGrossOf(selectedLines);
  const stoppageGross = sumGrossByType(selectedLines, ProfitLineType.STOPPAGE).sub(
    sumGrossByType(selectedLines, ProfitLineType.STOPPAGE_REFUND),
  );

  const status = deriveProfitStatus({
    selectedLines,
    issues: input.issues,
    isCancelled: input.isCancelled,
    isExcluded: input.isExcluded,
  });

  // NOT_COMPUTABLE has no trustworthy total; EXCLUDED is kept out of every net profit
  // figure on purpose. Both leave the net profit and margins empty while the totals
  // above are still reported. The reduce stays live for every other status, so the
  // "included rows minus effective VAT equals net profit" invariant keeps its teeth.
  const carriesProfit = status !== ProfitStatus.NOT_COMPUTABLE && status !== ProfitStatus.EXCLUDED;
  const netProfit = carriesProfit
    ? rows
        .filter((row) => row.includedInProfit)
        .reduce((acc, row) => acc.add(row.signedGross), ZERO)
        .sub(effective)
    : null;

  return {
    view: input.view,
    status,
    reconciliationStatus: deriveReconciliationStatus(selectedLines, input.issues),
    engineVersion: PROFIT_ENGINE_VERSION,
    selectedLines,
    rows,
    saleGross,
    costGross,
    vat: { ...vatTotals, effective },
    stoppageGross,
    stoppageIncluded: input.settings.includeStopaj,
    netProfit,
    saleMarginPct: ratioPct(netProfit, saleGross),
    costMarkupPct: ratioPct(netProfit, costGross),
    issues: input.issues,
  };
}
