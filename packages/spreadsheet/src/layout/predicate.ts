// Evaluates a row keep rule against a resolved layout. `has text` is `cellText`,
// `has decimal` reads with the grammar of the column's locator, and an absent column
// never holds.

import { cellDecimal, cellText, type CellRow } from '../cells';
import { columnGrammar, columnIndex } from './define';
import type { ColumnKey, LayoutSpec, ResolvedLayout, RowPredicate } from './types';

function holds(
  rule: Extract<RowPredicate<string>, { readonly op: 'has' }>,
  row: CellRow,
  spec: LayoutSpec,
  layout: ResolvedLayout,
): boolean {
  const index = columnIndex(spec, layout, rule.col);
  if (index === null) return false;
  switch (rule.as) {
    case 'text':
      return cellText(row, index) !== null;
    case 'decimal': {
      return cellDecimal(row, index, columnGrammar(spec, rule.col)) !== null;
    }
    default: {
      const exhaustive: never = rule.as;
      throw new Error(`Unhandled has-reading: ${String(exhaustive)}`);
    }
  }
}

function evaluateRule(
  rule: RowPredicate<string>,
  row: CellRow,
  spec: LayoutSpec,
  layout: ResolvedLayout,
): boolean {
  switch (rule.op) {
    case 'has':
      return holds(rule, row, spec, layout);
    case 'all':
      return rule.of.every((inner) => evaluateRule(inner, row, spec, layout));
    case 'any':
      return rule.of.some((inner) => evaluateRule(inner, row, spec, layout));
    default: {
      const exhaustive: never = rule;
      throw new Error(`Unhandled row predicate: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** True when `row` satisfies `rule` under the resolved `layout` of `spec`. */
export function evaluate<S extends LayoutSpec>(
  rule: RowPredicate<ColumnKey<S>>,
  row: CellRow,
  spec: S,
  layout: ResolvedLayout,
): boolean {
  return evaluateRule(rule, row, spec, layout);
}
