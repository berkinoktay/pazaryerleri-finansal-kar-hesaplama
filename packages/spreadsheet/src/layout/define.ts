// Builders for the layout DSL. `defineLayout` validates a spec once, at module load, so
// a malformed spec is a programmer error that fails fast rather than a silent miss.

import type { DecimalGrammar } from '../cells';
import type {
  ColumnLocator,
  BlockSpec,
  ColumnKey,
  HeaderLocator,
  LayoutSpec,
  PositionLocator,
  ResolvedLayout,
  RowPredicate,
} from './types';

/** The placeholder a block lookup template carries for the block's tag. */
export const TAG_PLACEHOLDER = '{tag}';

/** A column found by header text; the names are tried in order (name priority). */
export function header(...names: [string, ...string[]]): HeaderLocator {
  return { by: 'header', names };
}

/** A column found by header text, read with the given decimal grammar. */
export function headerWith(
  names: readonly [string, ...string[]],
  options: { readonly decimal: DecimalGrammar },
): HeaderLocator {
  return { by: 'header', names, decimal: options.decimal };
}

/** A column at a fixed index, optionally guarded by the header text expected there. */
export function position(
  index: number,
  sentinel?: string,
  options?: { readonly decimal?: DecimalGrammar },
): PositionLocator {
  const decimal = options?.decimal;
  return {
    by: 'position',
    index,
    ...(sentinel === undefined ? {} : { sentinel }),
    ...(decimal === undefined ? {} : { decimal }),
  };
}

/** A repeated block; returns the spec unchanged so its keys stay literal. */
export function block<const B extends BlockSpec>(spec: B): B {
  return spec;
}

/** Number of capture groups: an empty alternative always matches '', one array slot per group. */
function captureGroupCount(anchor: RegExp): number {
  const match = new RegExp(`${anchor.source}|`, anchor.flags).exec('');
  return match === null ? 0 : match.length - 1;
}

function validateBlock(key: string, spec: BlockSpec): void {
  const { anchor, min } = spec;
  if (anchor.global || anchor.sticky) {
    throw new Error(
      `Layout block "${key}": anchor ${String(anchor)} must not carry the g or y flag`,
    );
  }
  const groups = captureGroupCount(anchor);
  if (groups !== 1) {
    throw new Error(
      `Layout block "${key}": anchor ${String(anchor)} must have exactly one capture group, found ${groups}`,
    );
  }
  if (!Number.isInteger(min) || min < 0) {
    throw new Error(`Layout block "${key}": min must be a non-negative integer, got ${min}`);
  }
  for (const [name, column] of Object.entries(spec.columns)) {
    if (Object.hasOwn(spec.lookups, name)) {
      throw new Error(`Layout block "${key}": "${name}" is both a block column and a lookup`);
    }
    if (!isColumnNumber(column.offset)) {
      throw new Error(
        `Layout block "${key}": column "${name}" offset must be a non-negative integer, got ${column.offset}`,
      );
    }
  }
  for (const [name, lookup] of Object.entries(spec.lookups)) {
    if (!lookup.template.includes(TAG_PLACEHOLDER)) {
      throw new Error(
        `Layout block "${key}": lookup "${name}" template must contain ${TAG_PLACEHOLDER}`,
      );
    }
  }
}

/** A column index or block offset: a non-negative integer (a bad one would read null forever). */
function isColumnNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function validateLocator(key: string, locator: ColumnLocator): void {
  if (locator.by === 'position' && !isColumnNumber(locator.index)) {
    throw new Error(
      `Layout column "${key}": position must be a non-negative integer, got ${locator.index}`,
    );
  }
}

/** Specs that already passed assertValidLayout; a spec is a frozen-by-convention module constant. */
const validatedSpecs = new WeakSet<LayoutSpec>();

/**
 * Throws Error (a programmer error) when a spec breaks a rule the resolver relies on,
 * instead of letting it miss columns silently:
 *   - a block anchor with the g or y flag (exec would carry lastIndex between calls) or
 *     without exactly one capture group;
 *   - a negative block `min`;
 *   - a block key that is both a block column and a lookup;
 *   - a block column offset or a position that is not a non-negative integer;
 *   - a lookup template without the `{tag}` placeholder;
 *   - a key that is both required and optional.
 * defineLayout runs it at module load; resolveLayout runs it again, so a spec built by
 * hand cannot skip it.
 */
export function assertValidLayout(spec: LayoutSpec): void {
  if (validatedSpecs.has(spec)) return;
  for (const [key, blockSpec] of Object.entries(spec.blocks)) {
    validateBlock(key, blockSpec);
  }
  for (const [key, locator] of [
    ...Object.entries(spec.required),
    ...Object.entries(spec.optional),
  ]) {
    validateLocator(key, locator);
  }
  for (const key of Object.keys(spec.required)) {
    if (Object.hasOwn(spec.optional, key)) {
      throw new Error(`Layout key "${key}" is both required and optional`);
    }
  }
  validatedSpecs.add(spec);
}

/** Returns the spec unchanged, with its keys literal, after `assertValidLayout`. */
export function defineLayout<const S extends LayoutSpec>(spec: S): S {
  assertValidLayout(spec);
  return spec;
}

/** Keep the row when the column reads as text (`cellText`) or as a decimal in its grammar. */
export function has<K extends string>(col: K, as: 'text' | 'decimal'): RowPredicate<K> {
  return { op: 'has', col, as };
}

/** Keep the row when every rule holds. */
export function all<K extends string>(...of: RowPredicate<K>[]): RowPredicate<K> {
  return { op: 'all', of };
}

/** Keep the row when at least one rule holds. */
export function any<K extends string>(...of: RowPredicate<K>[]): RowPredicate<K> {
  return { op: 'any', of };
}

/** The decimal grammar a column, block column or lookup reads with when it names none. */
export const DEFAULT_GRAMMAR: DecimalGrammar = 'plain';

/** The decimal grammar of a layout column's locator; `DEFAULT_GRAMMAR` when it names none. */
export function columnGrammar(spec: LayoutSpec, key: string): DecimalGrammar {
  if (Object.hasOwn(spec.required, key)) return spec.required[key]?.decimal ?? DEFAULT_GRAMMAR;
  if (Object.hasOwn(spec.optional, key)) return spec.optional[key]?.decimal ?? DEFAULT_GRAMMAR;
  return DEFAULT_GRAMMAR;
}

/**
 * The column index of `key` in `layout`, or null when an optional column is absent.
 * `spec` is taken only so the compiler infers S from it and rejects a misspelled key.
 */
export function columnIndex<S extends LayoutSpec>(
  _spec: S,
  layout: ResolvedLayout,
  key: ColumnKey<S>,
): number | null {
  return layout.columns.get(key) ?? null;
}
