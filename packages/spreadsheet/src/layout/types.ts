// The layout DSL: a sheet's structure described as data. A `LayoutSpec` names where
// each column lives (by header or by position), which repeated blocks a header row
// carries, and which columns are required. `resolveLayout` turns a spec plus a grid
// into a `ResolvedLayout`. The resolved layout is string-keyed on purpose: typing
// lives in the accessors (`columnIndex`, `evaluate`), so no cast is ever needed.

import type { DecimalGrammar } from '../cells';

/** A column found by header text. Names are tried in order; the first name found wins. */
export interface HeaderLocator {
  readonly by: 'header';
  readonly names: readonly [string, ...string[]];
  readonly decimal?: DecimalGrammar;
}

/**
 * A column at a fixed index. It always resolves (no bounds check); with a `sentinel`,
 * the normalized header at `index` must equal it or the whole layout is rejected.
 */
export interface PositionLocator {
  readonly by: 'position';
  readonly index: number;
  readonly sentinel?: string;
  readonly decimal?: DecimalGrammar;
}

export type ColumnLocator = HeaderLocator | PositionLocator;

/** A block column at `anchor + offset` (no bounds check). */
export interface BlockColumn {
  readonly offset: number;
  readonly decimal?: DecimalGrammar;
}

/** A per-block column found by header text; `{tag}` in `template` is replaced with the block tag. */
export interface BlockLookup {
  readonly template: string;
  readonly decimal?: DecimalGrammar;
}

/** A repeated block, opened by every header that matches `anchor`. */
export interface BlockSpec {
  /** Exactly one capture group (the tag); no g/y flag. Runs on the normalized header. */
  readonly anchor: RegExp;
  /** Headers that must sit right after the anchor, in order; a mismatch rejects the layout. */
  readonly follow: readonly string[];
  readonly columns: Readonly<Record<string, BlockColumn>>;
  readonly lookups: Readonly<Record<string, BlockLookup>>;
  /** Fewer blocks than this rejects the layout. */
  readonly min: number;
}

export interface LayoutSpec {
  /** Only `grid[0]` is the header row today; a lookahead > 0 arrives with its first consumer. */
  readonly headerLookahead: 0;
  readonly required: Readonly<Record<string, ColumnLocator>>;
  readonly optional: Readonly<Record<string, ColumnLocator>>;
  readonly blocks: Readonly<Record<string, BlockSpec>>;
}

export type RequiredKey<S extends LayoutSpec> = keyof S['required'] & string;
export type OptionalKey<S extends LayoutSpec> = keyof S['optional'] & string;
export type ColumnKey<S extends LayoutSpec> = RequiredKey<S> | OptionalKey<S>;
export type BlockKey<S extends LayoutSpec> = keyof S['blocks'] & string;
export type BlockColumnKey<
  S extends LayoutSpec,
  B extends BlockKey<S>,
> = keyof S['blocks'][B]['columns'] & string;
export type BlockLookupKey<
  S extends LayoutSpec,
  B extends BlockKey<S>,
> = keyof S['blocks'][B]['lookups'] & string;

/** One resolved block: its numeric tag, its anchor column, and its column indexes. */
export interface ResolvedBlock {
  readonly tag: number;
  readonly anchor: number;
  readonly columns: ReadonlyMap<string, number>;
  /** Null when the templated header is absent. */
  readonly lookups: ReadonlyMap<string, number | null>;
}

export interface ResolvedLayout {
  readonly headerRowIndex: number;
  /** Every required (never null) and optional key. */
  readonly columns: ReadonlyMap<string, number | null>;
  /** Every block key, its blocks in column order. */
  readonly blocks: ReadonlyMap<string, readonly ResolvedBlock[]>;
}

/** A row keep rule over the layout's column keys. */
export type RowPredicate<K extends string> =
  | { readonly op: 'has'; readonly col: K; readonly as: 'text' | 'decimal' }
  | { readonly op: 'all'; readonly of: readonly RowPredicate<K>[] }
  | { readonly op: 'any'; readonly of: readonly RowPredicate<K>[] };
