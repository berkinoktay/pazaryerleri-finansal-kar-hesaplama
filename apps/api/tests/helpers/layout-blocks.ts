// Fail-loud accessors over the repeated blocks of a resolved layout, for tests.
//
// `ResolvedLayout.blocks` and a block's `columns` / `lookups` are string-keyed maps, so
// a test reading a block list with a `?? []` fallback, or a lookup with `?? null`,
// turns a lost block or a misspelt key into an empty list or a null column, and an
// assertion expecting 0 or null then passes without reading a cell. These accessors take
// the layout spec so the compiler rejects a misspelt key, and throw naming the key when
// the resolved layout does not hold it. Type-only imports: the unit config loads this
// file too, and nothing here may reach the database.

import type {
  BlockColumnKey,
  BlockKey,
  BlockLookupKey,
  LayoutSpec,
  ResolvedBlock,
  ResolvedLayout,
} from '@pazarsync/spreadsheet';

/**
 * The blocks of `block` in `layout`, in column order. An empty list is a legitimate
 * value (a block with `min: 0` and no anchor in the header); a key the layout does not
 * hold throws.
 */
export function blocksOf<S extends LayoutSpec, B extends BlockKey<S>>(
  _spec: S,
  layout: ResolvedLayout,
  block: B,
): readonly ResolvedBlock[] {
  const blocks = layout.blocks.get(block);
  if (blocks === undefined) {
    throw new Error(`The resolved layout holds no block "${block}"`);
  }
  return blocks;
}

/** The column index of block column `key`; throws when the block does not hold it. */
export function blockColumn<S extends LayoutSpec, B extends BlockKey<S>>(
  _spec: S,
  blockKey: B,
  block: ResolvedBlock,
  key: BlockColumnKey<S, B>,
): number {
  const col = block.columns.get(key);
  if (col === undefined) {
    throw new Error(`Block "${blockKey}" (tag ${block.tag}) holds no column "${key}"`);
  }
  return col;
}

/**
 * The column index of block lookup `key`, or null when its templated header is absent
 * (a legitimate value); throws when the block does not hold the lookup key.
 */
export function blockLookup<S extends LayoutSpec, B extends BlockKey<S>>(
  _spec: S,
  blockKey: B,
  block: ResolvedBlock,
  key: BlockLookupKey<S, B>,
): number | null {
  const col = block.lookups.get(key);
  if (col === undefined) {
    throw new Error(`Block "${blockKey}" (tag ${block.tag}) holds no lookup "${key}"`);
  }
  return col;
}

/** As `blockLookup`, and also throws when the lookup's templated header is absent. */
export function requiredBlockLookup<S extends LayoutSpec, B extends BlockKey<S>>(
  spec: S,
  blockKey: B,
  block: ResolvedBlock,
  key: BlockLookupKey<S, B>,
): number {
  const col = blockLookup(spec, blockKey, block, key);
  if (col === null) {
    throw new Error(
      `Block "${blockKey}" (tag ${block.tag}): the header of lookup "${key}" is absent`,
    );
  }
  return col;
}
