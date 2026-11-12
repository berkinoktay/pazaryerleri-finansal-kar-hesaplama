// Resolves a layout spec against a grid's header row. The rules reproduce the six
// hand-written Trendyol resolvers: headers are normalized and matched exactly,
// first match wins, aliases are name-priority, positions and offsets are not
// bounds-checked, and only sentinels and `follow` headers check adjacency.

import { findHeader, normalizeHeader } from '../cells';
import { assertValidLayout, TAG_PLACEHOLDER } from './define';
import type { SheetData } from '../grid-types';
import type { BlockSpec, ColumnLocator, LayoutSpec, ResolvedBlock, ResolvedLayout } from './types';

/** `headerLookahead` is 0, so the header row is always the first grid row. */
const HEADER_ROW_INDEX = 0;

/** A located column (index null = absent), or a sentinel mismatch that rejects the layout. */
type Located =
  | { readonly kind: 'column'; readonly index: number | null }
  | { readonly kind: 'reject' };

const REJECT: Located = { kind: 'reject' };

/** Name priority: the first column of the first name found. */
function firstNamedColumn(headers: readonly string[], names: readonly string[]): number | null {
  for (const name of names) {
    const index = findHeader(headers, name);
    if (index >= 0) return index;
  }
  return null;
}

function locate(locator: ColumnLocator, headers: readonly string[]): Located {
  switch (locator.by) {
    case 'header':
      return { kind: 'column', index: firstNamedColumn(headers, locator.names) };
    case 'position': {
      const { index, sentinel } = locator;
      if (sentinel !== undefined && headers[index] !== normalizeHeader(sentinel)) return REJECT;
      return { kind: 'column', index };
    }
    default: {
      const exhaustive: never = locator;
      throw new Error(`Unhandled column locator: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function resolveColumns(
  spec: LayoutSpec,
  headers: readonly string[],
): Map<string, number | null> | null {
  const columns = new Map<string, number | null>();
  for (const [key, locator] of Object.entries(spec.required)) {
    const located = locate(locator, headers);
    if (located.kind === 'reject' || located.index === null) return null;
    columns.set(key, located.index);
  }
  for (const [key, locator] of Object.entries(spec.optional)) {
    const located = locate(locator, headers);
    if (located.kind === 'reject') return null;
    columns.set(key, located.index);
  }
  return columns;
}

/**
 * Every header the anchor matches (with a defined capture) opens a block, in column
 * order. A broken `follow` rejects the whole layout, as do fewer than `min` blocks.
 */
function resolveBlocks(spec: BlockSpec, headers: readonly string[]): ResolvedBlock[] | null {
  const follow = spec.follow.map(normalizeHeader);
  const blocks: ResolvedBlock[] = [];
  for (const [anchor, text] of headers.entries()) {
    const capture = spec.anchor.exec(text)?.[1];
    if (capture === undefined) continue;
    const tag = Number(capture);
    // A capture that is not a number cannot tag a block (its lookups would all miss).
    if (Number.isNaN(tag)) continue;
    if (!follow.every((expected, k) => headers[anchor + 1 + k] === expected)) return null;

    const columns = new Map<string, number>();
    for (const [key, column] of Object.entries(spec.columns)) {
      columns.set(key, anchor + column.offset);
    }
    const lookups = new Map<string, number | null>();
    for (const [key, lookup] of Object.entries(spec.lookups)) {
      const index = findHeader(headers, lookup.template.replace(TAG_PLACEHOLDER, String(tag)));
      lookups.set(key, index < 0 ? null : index);
    }
    blocks.push({ tag, anchor, columns, lookups });
  }
  return blocks.length < spec.min ? null : blocks;
}

/**
 * The layout of `grid`, or null when the header row does not fit the spec: a missing
 * required column, a sentinel mismatch, a broken `follow`, or too few blocks. An
 * absent optional column resolves to a null entry.
 */
export function resolveLayout(spec: LayoutSpec, grid: SheetData): ResolvedLayout | null {
  assertValidLayout(spec);
  const headers = (grid[HEADER_ROW_INDEX] ?? []).map(normalizeHeader);

  const columns = resolveColumns(spec, headers);
  if (columns === null) return null;

  const blocks = new Map<string, readonly ResolvedBlock[]>();
  for (const [key, blockSpec] of Object.entries(spec.blocks)) {
    const resolved = resolveBlocks(blockSpec, headers);
    if (resolved === null) return null;
    blocks.set(key, resolved);
  }

  return { headerRowIndex: HEADER_ROW_INDEX, columns, blocks };
}
