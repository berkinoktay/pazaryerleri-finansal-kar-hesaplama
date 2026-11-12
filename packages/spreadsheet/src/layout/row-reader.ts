// The typed row reader: one data row read through a resolved layout. Column, block,
// block-column and lookup keys are typed from the spec, so a misspelled key is a
// compile error. Every method reads through the cell readers at the layout's
// resolved index; an absent column (or an absent lookup header) reads as null, or
// as false for the flags.

import {
  cellDecimal,
  cellFlag,
  cellInstant,
  cellInt,
  cellNumericFlag,
  cellText,
  type CellRow,
  type DecimalGrammar,
  type FlagRule,
  type IntMode,
  type WallClockPattern,
} from '../cells';
import { columnGrammar, columnIndex, DEFAULT_GRAMMAR } from './define';
import type {
  BlockColumnKey,
  BlockKey,
  BlockLookupKey,
  BlockSpec,
  ColumnKey,
  LayoutSpec,
  ResolvedBlock,
  ResolvedLayout,
} from './types';

/** Reads one repeated block of a row: its tag, and its block columns and lookups by key. */
export interface BlockReader<S extends LayoutSpec, B extends BlockKey<S>> {
  readonly tag: number;
  text(c: BlockColumnKey<S, B> | BlockLookupKey<S, B>): string | null;
  /** The grammar comes from the block column or lookup (default `plain`). */
  decimal(c: BlockColumnKey<S, B> | BlockLookupKey<S, B>): string | null;
}

/** Reads one data row by layout key. */
export interface RowReader<S extends LayoutSpec> {
  text(col: ColumnKey<S>): string | null;
  /** The grammar comes from the column's locator (default `plain`). */
  decimal(col: ColumnKey<S>): string | null;
  int(col: ColumnKey<S>, mode: IntMode): number | null;
  flag(col: ColumnKey<S>, rule: FlagRule): boolean;
  numericFlag(col: ColumnKey<S>): boolean;
  instant(col: ColumnKey<S>, pattern: WallClockPattern): Date | null;
  /** One reader per resolved block, in column order. */
  blocks<B extends BlockKey<S>>(name: B): readonly BlockReader<S, B>[];
}

function blockSpecOf(spec: LayoutSpec, name: string): BlockSpec | undefined {
  return Object.hasOwn(spec.blocks, name) ? spec.blocks[name] : undefined;
}

/** The decimal grammar of a block column or lookup; a block column wins a key clash. */
function blockGrammar(blockSpec: BlockSpec | undefined, key: string): DecimalGrammar {
  if (blockSpec === undefined) return DEFAULT_GRAMMAR;
  if (Object.hasOwn(blockSpec.columns, key)) {
    return blockSpec.columns[key]?.decimal ?? DEFAULT_GRAMMAR;
  }
  if (Object.hasOwn(blockSpec.lookups, key)) {
    return blockSpec.lookups[key]?.decimal ?? DEFAULT_GRAMMAR;
  }
  return DEFAULT_GRAMMAR;
}

/** A block column's index, else a lookup's (null when its header is absent); a block column wins a key clash. */
function blockCellIndex(block: ResolvedBlock, key: string): number | null {
  return block.columns.get(key) ?? block.lookups.get(key) ?? null;
}

/**
 * A string-keyed block reader. `BlockReader<LayoutSpec, string>` takes any string key,
 * so it is assignable to every narrower `BlockReader<S, B>` without a cast.
 */
function readBlock(
  blockSpec: BlockSpec | undefined,
  block: ResolvedBlock,
  row: CellRow,
): BlockReader<LayoutSpec, string> {
  return {
    tag: block.tag,
    text: (c) => cellText(row, blockCellIndex(block, c)),
    decimal: (c) => cellDecimal(row, blockCellIndex(block, c), blockGrammar(blockSpec, c)),
  };
}

/** A reader over `row` under the resolved `layout` of `spec`; `toInstant` turns a wall clock into an instant. */
export function createRowReader<S extends LayoutSpec>(
  spec: S,
  layout: ResolvedLayout,
  row: CellRow,
  options: { readonly toInstant: (wallClockMs: number) => Date },
): RowReader<S> {
  const at = (col: ColumnKey<S>): number | null => columnIndex(spec, layout, col);
  return {
    text: (col) => cellText(row, at(col)),
    decimal: (col) => cellDecimal(row, at(col), columnGrammar(spec, col)),
    int: (col, mode) => cellInt(row, at(col), mode),
    flag: (col, rule) => cellFlag(row, at(col), rule),
    numericFlag: (col) => cellNumericFlag(row, at(col)),
    instant: (col, pattern) => cellInstant(row, at(col), pattern, options.toInstant),
    blocks: (name) => {
      const blockSpec = blockSpecOf(spec, name);
      return (layout.blocks.get(name) ?? []).map((block) => readBlock(blockSpec, block, row));
    },
  };
}
