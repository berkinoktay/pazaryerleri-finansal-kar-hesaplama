import { describe, expect, it } from 'vitest';

import { DEFAULT_ROW_CAP, MAX_PATCH_TEXT_LENGTH } from '../constants';
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
const DEFAULT_COLS = 64;

function num(excelRow: number, col: number, value = '1'): CellPatch {
  return { excelRow, col, value: { kind: 'number', value } };
}

function text(excelRow: number, col: number, value: string): CellPatch {
  return { excelRow, col, value: { kind: 'text', value } };
}

function anchor(excelRow: number, col: number, expected: string): PatchAnchor {
  return { excelRow, col, expected };
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
    ['col 64', { outputs: [[num(1, DEFAULT_COLS)]] }],
    ['the same cell twice in one output', { outputs: [[num(3, 4), num(3, 4)]] }],
    ['the value 1e-7', { outputs: [[num(1, 0, '1e-7')]] }],
    ['an empty anchor', { outputs: [[]], anchors: [anchor(1, 0, '')] }],
    ['an untrimmed anchor', { outputs: [[]], anchors: [anchor(1, 0, ' x')] }],
    ['two anchors on one cell', { outputs: [[]], anchors: [anchor(1, 0, 'a'), anchor(1, 0, 'b')] }],
  ])('throws for %s', (_label, options) => {
    expect(() => resolvePatchRequest(options)).toThrow('Invalid patch request');
  });

  it('throws when all outputs together exceed the cell budget', () => {
    const cells = Array.from({ length: CELLS_PER_OUTPUT_OVER_CAP }, (_, i) =>
      num(Math.floor(i / DEFAULT_COLS) + 1, i % DEFAULT_COLS),
    );
    const outputs = Array.from({ length: OUTPUTS_AT_CAP }, () => cells);
    expect(() => resolvePatchRequest({ outputs, rowCap: 20_000 })).toThrow('Invalid patch request');
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
  ])('rejects %s', (_label, value) => {
    expect(isResolvedPatchRequest(value)).toBe(false);
  });
});
