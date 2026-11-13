import { describe, expect, it } from 'vitest';

import {
  ABSOLUTE_MAX_COLS,
  DEFAULT_COL_CAP,
  DEFAULT_ROW_CAP,
  MAX_PATCH_REQUEST_TEXT_LENGTH,
  MAX_PATCH_TEXT_LENGTH,
} from '../constants';
import {
  isResolvedPatchRequest,
  resolvePatchRequest,
  type CellPatch,
  type PatchAnchor,
} from './patch-request';

const LONG_TEXT = 'x'.repeat(MAX_PATCH_TEXT_LENGTH);
const LONG_NUL_TEXT = '\u0000'.repeat(MAX_PATCH_TEXT_LENGTH);
// 600 x 32 767 is about 19.6 M units, above the 16 M request budget.
const OVER_BUDGET_PATCHES = 600;
// 513 x 32 767 is just above the 16 M request budget.
const OVER_BUDGET_ANCHORS = 513;
// 8 x 62 501 is just above the 500 000 cell budget.
const OUTPUTS_AT_CAP = 8;
const CELLS_PER_OUTPUT_OVER_CAP = 62_501;
// 8 x 62 500 is exactly the 500 000 cell budget.
const CELLS_PER_OUTPUT_AT_CAP = 62_500;
const WIDE_ROW_CAP = 20_000;
// 512 x 32 767 plus 512 units is exactly the 16 M request budget.
const LONG_TEXTS_AT_BUDGET = Math.floor(MAX_PATCH_REQUEST_TEXT_LENGTH / MAX_PATCH_TEXT_LENGTH);
const BUDGET_REMAINDER = MAX_PATCH_REQUEST_TEXT_LENGTH % MAX_PATCH_TEXT_LENGTH;

function num(excelRow: number, col: number, value = '1'): CellPatch {
  return { excelRow, col, value: { kind: 'number', value } };
}

function text(excelRow: number, col: number, value: string): CellPatch {
  return { excelRow, col, value: { kind: 'text', value } };
}

function anchor(excelRow: number, col: number, expected: string): PatchAnchor {
  return { excelRow, col, expected };
}

function cellsOnGrid(count: number): CellPatch[] {
  return Array.from({ length: count }, (_, i) =>
    num(Math.floor(i / DEFAULT_COL_CAP) + 1, i % DEFAULT_COL_CAP),
  );
}

/** An array of `length` holes; `every` would skip them, an indexed walk does not. */
function sparse(length: number): unknown[] {
  const holes: unknown[] = [];
  holes.length = length;
  return holes;
}

describe('resolvePatchRequest', () => {
  it('sorts each output by row, then column', () => {
    const resolved = resolvePatchRequest({ outputs: [[num(5, 3), num(2, 9), num(2, 1)]] });
    expect(resolved.outputs).toEqual([[num(2, 1), num(2, 9), num(5, 3)]]);
  });

  it('drops extra properties of a patch', () => {
    const withExtra = {
      excelRow: 2,
      col: 1,
      value: { kind: 'number', value: '1' },
      extra: 'x',
    } as const;
    const resolved = resolvePatchRequest({ outputs: [[withExtra]] });
    const patch = resolved.outputs[0]?.[0];
    expect(patch).toEqual(num(2, 1));
    expect(Object.keys(patch ?? {})).toEqual(['excelRow', 'col', 'value']);
  });

  it('sorts the formula columns and drops repeats', () => {
    const resolved = resolvePatchRequest({ outputs: [[]], overwriteFormulaColumns: [19, 17, 17] });
    expect(resolved.overwriteFormulaColumns).toEqual([17, 19]);
  });

  it('resolves the read options with the default row cap', () => {
    expect(resolvePatchRequest({ outputs: [[]] }).read.rowCap).toBe(DEFAULT_ROW_CAP);
    expect(DEFAULT_ROW_CAP).toBe(5000);
  });

  it('keeps an empty output empty', () => {
    const resolved = resolvePatchRequest({ outputs: [[], [num(1, 0)]] });
    expect(resolved.outputs).toEqual([[], [num(1, 0)]]);
    expect(resolved.anchors).toEqual([]);
  });

  it('accepts the last row and the last column the read options allow', () => {
    const resolved = resolvePatchRequest({
      outputs: [[num(DEFAULT_ROW_CAP + 1, 0), num(1, DEFAULT_COL_CAP - 1)]],
    });
    expect(resolved.outputs).toEqual([[num(1, DEFAULT_COL_CAP - 1), num(DEFAULT_ROW_CAP + 1, 0)]]);
  });

  it('accepts exactly the cell budget across all outputs', () => {
    const cells = cellsOnGrid(CELLS_PER_OUTPUT_AT_CAP);
    const outputs = Array.from({ length: OUTPUTS_AT_CAP }, () => cells);
    expect(() => resolvePatchRequest({ outputs, rowCap: WIDE_ROW_CAP })).not.toThrow();
  });

  it('accepts patch text of exactly the request budget', () => {
    const patches = Array.from({ length: LONG_TEXTS_AT_BUDGET }, (_, i) =>
      text(i + 1, 0, LONG_TEXT),
    );
    patches.push(text(LONG_TEXTS_AT_BUDGET + 1, 0, 'x'.repeat(BUDGET_REMAINDER)));
    expect(() => resolvePatchRequest({ outputs: [patches] })).not.toThrow();
  });

  it('throws for more formula columns than any sheet can hold', () => {
    const overwriteFormulaColumns = Array.from({ length: ABSOLUTE_MAX_COLS + 1 }, () => 0);
    expect(() => resolvePatchRequest({ outputs: [[]], overwriteFormulaColumns })).toThrow(
      'formula columns exceed',
    );
  });

  it('allows the same cell in two outputs', () => {
    expect(() => resolvePatchRequest({ outputs: [[num(1, 0)], [num(1, 0)]] })).not.toThrow();
  });

  it.each([
    ['no outputs', { outputs: [] }],
    ['9 outputs', { outputs: Array.from({ length: 9 }, () => []) }],
    ['excelRow 0', { outputs: [[num(0, 0)]] }],
    ['excelRow 1.5', { outputs: [[num(1.5, 0)]] }],
    ['excelRow rowCap + 2', { outputs: [[num(DEFAULT_ROW_CAP + 2, 0)]] }],
    ['col -1', { outputs: [[num(1, -1)]] }],
    ['col 64', { outputs: [[num(1, DEFAULT_COL_CAP)]] }],
    ['the same cell twice in one output', { outputs: [[num(3, 4), num(3, 4)]] }],
    ['the value 1e-7', { outputs: [[num(1, 0, '1e-7')]] }],
    ['an empty anchor', { outputs: [[]], anchors: [anchor(1, 0, '')] }],
    ['an untrimmed anchor', { outputs: [[]], anchors: [anchor(1, 0, ' x')] }],
    ['two anchors on one cell', { outputs: [[]], anchors: [anchor(1, 0, 'a'), anchor(1, 0, 'b')] }],
  ])('throws for %s', (_label, options) => {
    expect(() => resolvePatchRequest(options)).toThrow('Invalid patch request');
  });

  it('throws when all outputs together exceed the cell budget', () => {
    const cells = cellsOnGrid(CELLS_PER_OUTPUT_OVER_CAP);
    const outputs = Array.from({ length: OUTPUTS_AT_CAP }, () => cells);
    expect(() => resolvePatchRequest({ outputs, rowCap: WIDE_ROW_CAP })).toThrow(
      'Invalid patch request',
    );
  });

  it('throws on the text budget for many long text patches', () => {
    const patches = Array.from({ length: OVER_BUDGET_PATCHES }, (_, i) =>
      text(i + 1, 0, LONG_TEXT),
    );
    expect(() => resolvePatchRequest({ outputs: [patches] })).toThrow('text exceeds');
  });

  it('throws on the text budget for many long anchors', () => {
    const anchors = Array.from({ length: OVER_BUDGET_ANCHORS }, (_, i) =>
      anchor(i + 1, 0, LONG_TEXT),
    );
    expect(() => resolvePatchRequest({ outputs: [[]], anchors })).toThrow('text exceeds');
  });

  it('checks the text budget before the characters', () => {
    const patches = Array.from({ length: OVER_BUDGET_PATCHES }, (_, i) =>
      text(i + 1, 0, LONG_NUL_TEXT),
    );
    expect(() => resolvePatchRequest({ outputs: [patches] })).toThrow('text exceeds');
  });

  it('throws the read options error for a sheet together with a sheet name', () => {
    expect(() =>
      resolvePatchRequest({ outputs: [[]], sheet: { by: 'index', index: 0 }, sheetName: 'S' }),
    ).toThrow('Pass either sheet or sheetName, not both');
  });
});

describe('isResolvedPatchRequest', () => {
  const resolved = resolvePatchRequest({
    outputs: [[num(2, 1), text(3, 2, 'a'), { excelRow: 4, col: 0, value: { kind: 'clear' } }]],
    anchors: [anchor(1, 0, 'Barkod')],
    overwriteFormulaColumns: [5],
  });
  const cloned = structuredClone(resolved);

  it('accepts a resolved request after a structured clone', () => {
    expect(isResolvedPatchRequest(cloned)).toBe(true);
  });

  it.each([
    [
      'an unknown value kind',
      { ...cloned, outputs: [[{ excelRow: 1, col: 0, value: { kind: 'bogus', value: '1' } }]] },
    ],
    [
      'a fractional row',
      { ...cloned, outputs: [[{ excelRow: 1.5, col: 0, value: { kind: 'clear' } }]] },
    ],
    [
      'a missing read',
      {
        anchors: cloned.anchors,
        outputs: cloned.outputs,
        overwriteFormulaColumns: cloned.overwriteFormulaColumns,
      },
    ],
    ['a read whose rowCap is 0', { ...cloned, read: { ...cloned.read, rowCap: 0 } }],
    ['a read whose rowCap is 1.5', { ...cloned, read: { ...cloned.read, rowCap: 1.5 } }],
    ['sparse outputs', { ...cloned, outputs: sparse(1) }],
    ['sparse formula columns', { ...cloned, overwriteFormulaColumns: sparse(1) }],
    ['sparse anchors', { ...cloned, anchors: sparse(1) }],
  ])('rejects %s', (_label, value) => {
    expect(isResolvedPatchRequest(value)).toBe(false);
  });
});
