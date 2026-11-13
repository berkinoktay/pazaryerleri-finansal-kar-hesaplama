import { describe, expect, it } from 'vitest';

import { num } from '../../tests/helpers/patch-helpers';
import { expectWithinBudget, LINEAR_BUDGET_MS } from '../../tests/helpers/timing';
import {
  ABSOLUTE_MAX_COLS,
  ABSOLUTE_MAX_ROWS,
  DEFAULT_COL_CAP,
  DEFAULT_ROW_CAP,
} from '../constants';
import { SpreadsheetFileError } from '../errors';
import type { GridCaps } from '../part-checks';
import { columnLetters } from '../sheet-meta';
import { assertTargetsOutsideMerges } from './merged-ranges';
import type { CellPatch } from './patch-request';
import { MALFORMED_SHEET_REASONS } from './reasons';

const CAPS: GridCaps = { rowCap: DEFAULT_ROW_CAP, colCap: DEFAULT_COL_CAP };
const MAX_CAPS: GridCaps = { rowCap: ABSOLUTE_MAX_ROWS, colCap: ABSOLUTE_MAX_COLS };
const B2_C3 = ['B2:C3'];

// 0-based grid columns of the letters the tests name.
const COL_A = 0;
const COL_B = 1;
const COL_C = 2;
const COL_D = 3;

const MANY_REFS = 200_000;
const MANY_TARGETS = 200_000;
const TARGET_COLUMNS = 10;
const LINEAR_TEST_TIMEOUT_MS = 120_000;

/** A patch on row `excelRow`, 0-based column `col`. */
function target(excelRow: number, col: number): CellPatch {
  return num(excelRow, col, '1');
}

function fileErrorOf(run: () => unknown): SpreadsheetFileError {
  try {
    run();
  } catch (error) {
    if (error instanceof SpreadsheetFileError) return error;
    throw error;
  }
  throw new Error('Expected a SpreadsheetFileError');
}

function expectMalformed(run: () => unknown, meta: Record<string, unknown>): void {
  const error = fileErrorOf(run);
  expect(error.code).toBe('MALFORMED_SHEET');
  expect(error.meta).toEqual(meta);
}

function mergedTarget(count: number, rows: readonly number[]): Record<string, unknown> {
  return { reason: MALFORMED_SHEET_REASONS.MERGED_TARGET, count, rows };
}

describe('assertTargetsOutsideMerges: one range', () => {
  it.each([
    ['C2', 2, COL_C],
    ['B3', 3, COL_B],
    ['C3', 3, COL_C],
  ])('rejects a target on %s inside B2:C3', (_name, row, col) => {
    expectMalformed(
      () => assertTargetsOutsideMerges(B2_C3, [[target(row, col)]], CAPS),
      mergedTarget(1, [row]),
    );
  });

  it.each([
    ['B2 (the top-left corner)', 2, COL_B],
    ['D2 (outside)', 2, COL_D],
    ['A1 (outside)', 1, COL_A],
  ])('passes a target on %s', (_name, row, col) => {
    expect(() => assertTargetsOutsideMerges(B2_C3, [[target(row, col)]], CAPS)).not.toThrow();
  });

  it('orders the corners of a range written bottom-right first', () => {
    expect(() => assertTargetsOutsideMerges(['C3:B2'], [[target(2, COL_B)]], CAPS)).not.toThrow();
    expectMalformed(
      () => assertTargetsOutsideMerges(['C3:B2'], [[target(3, COL_C)]], CAPS),
      mergedTarget(1, [3]),
    );
  });

  it('passes a target on a single-cell range', () => {
    expect(() => assertTargetsOutsideMerges(['B2'], [[target(2, COL_B)]], CAPS)).not.toThrow();
    expect(() => assertTargetsOutsideMerges(['B2:B2'], [[target(2, COL_B)]], CAPS)).not.toThrow();
  });

  it('passes anything when there are no ranges', () => {
    expect(() => assertTargetsOutsideMerges([], [[target(2, COL_C)]], CAPS)).not.toThrow();
  });
});

describe('assertTargetsOutsideMerges: counts and rows', () => {
  it('counts rejected patches over all outputs and lists their distinct rows', () => {
    const outputs = [[target(2, COL_C), target(3, COL_B)], [target(2, COL_C)]];
    expectMalformed(
      () => assertTargetsOutsideMerges(B2_C3, outputs, CAPS),
      mergedTarget(3, [2, 3]),
    );
  });

  it('rejects a top-left corner that a second range also covers', () => {
    expectMalformed(
      () => assertTargetsOutsideMerges(['B2:C3', 'B2:D4'], [[target(2, COL_B)]], CAPS),
      mergedTarget(1, [2]),
    );
  });

  it('lists the first rows ascending across outputs', () => {
    const late = Array.from({ length: 12 }, (_, position) => target(position + 9, COL_C));
    const early = Array.from({ length: 8 }, (_, position) => target(position + 2, COL_C));
    expectMalformed(
      () => assertTargetsOutsideMerges(['B2:C40'], [late, early], CAPS),
      mergedTarget(20, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    );
  });
});

describe('assertTargetsOutsideMerges: malformed references', () => {
  it.each(['', 'B2:', 'b2:c3', ' B2:C3', 'B2:C3 ', 'A0', 'B02', 'AAAA1', 'A12345678', 'B2:C3:D4'])(
    'rejects the reference %j',
    (ref) => {
      expectMalformed(() => assertTargetsOutsideMerges([ref], [[]], CAPS), {
        reason: MALFORMED_SHEET_REASONS.MERGE_REF,
      });
    },
  );

  it('rejects a malformed reference after a valid one, before any target is checked', () => {
    expectMalformed(
      () => assertTargetsOutsideMerges(['B2:C3', 'b2:c3'], [[target(2, COL_C)]], CAPS),
      { reason: MALFORMED_SHEET_REASONS.MERGE_REF },
    );
  });
});

describe('assertTargetsOutsideMerges: clipping', () => {
  it('clips a whole-sheet range to the caps and keeps its top-left corner', () => {
    const whole = ['A1:XFD1048576'];
    expect(() => assertTargetsOutsideMerges(whole, [[target(1, COL_A)]], CAPS)).not.toThrow();
    expectMalformed(
      () => assertTargetsOutsideMerges(whole, [[target(2, COL_B)]], CAPS),
      mergedTarget(1, [2]),
    );
  });

  it('leaves a target outside the area or on a fractional column to the patcher', () => {
    const ref = [`A1:C${CAPS.rowCap + 10}`];
    const beyondRows = target(CAPS.rowCap + 5, COL_B);
    const fractional: CellPatch = { excelRow: 2, col: 1.5, value: { kind: 'clear' } };
    expect(() => assertTargetsOutsideMerges(ref, [[beyondRows], [fractional]], CAPS)).not.toThrow();
  });

  it('covers the last row and column of the absolute caps', () => {
    const lastRow = MAX_CAPS.rowCap + 1;
    const lastLetters = columnLetters(MAX_CAPS.colCap);
    const beforeLetters = columnLetters(MAX_CAPS.colCap - 1);
    const ref = [`${beforeLetters}${lastRow - 1}:${lastLetters}${lastRow}`];
    const lastCol = MAX_CAPS.colCap - 1;
    expectMalformed(
      () => assertTargetsOutsideMerges(ref, [[target(lastRow, lastCol)]], MAX_CAPS),
      mergedTarget(1, [lastRow]),
    );
    expect(() =>
      assertTargetsOutsideMerges(ref, [[target(lastRow - 1, lastCol - 1)]], MAX_CAPS),
    ).not.toThrow();
  });
});

describe('assertTargetsOutsideMerges: linear time', { timeout: LINEAR_TEST_TIMEOUT_MS }, () => {
  it('checks 200 000 targets against 200 000 ranges', () => {
    const rows = MANY_TARGETS / TARGET_COLUMNS;
    // Each row's C:D range, repeated until there are MANY_REFS of them.
    const refs = Array.from({ length: MANY_REFS }, (_, position) => {
      const row = (position % rows) + 1;
      return `C${row}:D${row}`;
    });
    // Columns D (covered: rejected) to M (outside every range).
    const targets: CellPatch[] = [];
    for (let row = 1; row <= rows; row += 1) {
      for (let col = COL_D; col < COL_D + TARGET_COLUMNS; col += 1) targets.push(target(row, col));
    }

    const started = performance.now();
    const error = fileErrorOf(() => assertTargetsOutsideMerges(refs, [targets], MAX_CAPS));
    expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);

    expect(error.code).toBe('MALFORMED_SHEET');
    expect(error.meta).toEqual(mergedTarget(rows, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });
});
