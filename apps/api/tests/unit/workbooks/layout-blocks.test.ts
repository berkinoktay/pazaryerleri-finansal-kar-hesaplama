// The fail-loud block accessors of tests/helpers/layout-blocks.ts: each returns the
// index the resolver found, and throws naming the key when the resolved layout does not
// hold it, so a lost block or a misspelt key can never turn into an empty list or a null
// column. A lookup whose templated header is absent is a legitimate null.

import {
  block,
  defineLayout,
  header,
  resolveLayout,
  type ResolvedBlock,
  type ResolvedLayout,
} from '@pazarsync/spreadsheet';
import { describe, expect, it } from 'vitest';

import {
  blockColumn,
  blockLookup,
  blocksOf,
  requiredBlockLookup,
} from '../../helpers/layout-blocks';

const SPEC = defineLayout({
  headerLookahead: 0,
  required: { id: header('Id') },
  optional: {},
  blocks: {
    periods: block({
      anchor: /^Period \((\d+)\)$/,
      follow: [],
      columns: { label: { offset: 0 } },
      lookups: { total: { template: 'Total ({tag})' } },
      min: 0,
    }),
  },
});

function mustResolve(headerRow: readonly string[]): ResolvedLayout {
  const layout = resolveLayout(SPEC, [[...headerRow]]);
  if (layout === null) throw new Error('expected the layout to resolve');
  return layout;
}

function firstBlock(layout: ResolvedLayout): ResolvedBlock {
  const first = blocksOf(SPEC, layout, 'periods')[0];
  if (first === undefined) throw new Error('expected a period block');
  return first;
}

// A block whose maps hold no key at all: the state a lost column or lookup leaves behind.
const BARE_BLOCK: ResolvedBlock = {
  tag: 3,
  anchor: 1,
  columns: new Map(),
  lookups: new Map(),
};

describe('layout block accessors', () => {
  const layout = mustResolve(['Id', 'Period (3)', 'Total (3)']);

  it('returns the blocks, the column and the lookup the resolver found', () => {
    expect(blocksOf(SPEC, layout, 'periods').map((b) => b.tag)).toEqual([3]);
    const period = firstBlock(layout);
    expect(blockColumn(SPEC, 'periods', period, 'label')).toBe(1);
    expect(blockLookup(SPEC, 'periods', period, 'total')).toBe(2);
    expect(requiredBlockLookup(SPEC, 'periods', period, 'total')).toBe(2);
  });

  it('returns an empty list for a block key the layout holds with no block', () => {
    expect(blocksOf(SPEC, mustResolve(['Id']), 'periods')).toEqual([]);
  });

  it('throws naming the block when the layout does not hold the block key', () => {
    const noBlocks: ResolvedLayout = {
      headerRowIndex: 0,
      columns: new Map([['id', 0]]),
      blocks: new Map(),
    };
    expect(() => blocksOf(SPEC, noBlocks, 'periods')).toThrow(/"periods"/);
  });

  it('throws naming the column when the block does not hold it', () => {
    expect(() => blockColumn(SPEC, 'periods', BARE_BLOCK, 'label')).toThrow(/"label"/);
  });

  it('throws naming the lookup when the block does not hold it', () => {
    expect(() => blockLookup(SPEC, 'periods', BARE_BLOCK, 'total')).toThrow(/"total"/);
    expect(() => requiredBlockLookup(SPEC, 'periods', BARE_BLOCK, 'total')).toThrow(/"total"/);
  });

  it('gives null for an absent templated header, and the strict accessor throws on it', () => {
    const period = firstBlock(mustResolve(['Id', 'Period (3)']));
    expect(blockLookup(SPEC, 'periods', period, 'total')).toBeNull();
    expect(() => requiredBlockLookup(SPEC, 'periods', period, 'total')).toThrow(/"total"/);
  });

  it('rejects a misspelt key at compile time', () => {
    // @ts-expect-error -- 'lable' is not a column of the periods block; the api typecheck is the proof.
    expect(() => blockColumn(SPEC, 'periods', BARE_BLOCK, 'lable')).toThrow(/"lable"/);
  });
});
