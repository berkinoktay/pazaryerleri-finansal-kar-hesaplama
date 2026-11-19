// The export's checks before the engine runs (`plannedDownloadNames`): the summed patch
// cell count of a plan is refused as a logged stored-file conflict once it exceeds what
// one engine call patches.

import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { MAX_PATCH_CELLS, type CellPatch } from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { WorkbookConflictError } from '@/lib/errors';
import type { ExportPlan, PlannedFile } from '@/workbooks/export-plan';
import {
  plannedDownloadNames,
  TOO_MANY_CELLS_REASON,
  type ExportContext,
} from '@/workbooks/export-workbook';
import type { FilenamePolicy } from '@/workbooks/format';

const CONTEXT: ExportContext = {
  page: WORKBOOK_PAGES.COMMISSION_TARIFF,
  recordId: '6a1d0c4e-2b7f-4e8a-9c3d-5f0b1e2a7c94',
};
const WINDOW: FilenamePolicy = {
  kind: 'window',
  base: 'tariff',
  labelUnit: 'Days',
  fileUnit: 'gunluk',
};
const FORMAT = { filename: WINDOW, defaultName: 'Tariff' };
const SOURCE = { name: 'My tariff', sourceFilename: null };
// Two files whose cells add up to MAX_PATCH_CELLS.
const FIRST_HALF = Math.floor(MAX_PATCH_CELLS / 2);
const SECOND_HALF = MAX_PATCH_CELLS - FIRST_HALF;

// One shared patch: the check counts entries, it never reads them.
const PATCH: CellPatch = { excelRow: 2, col: 3, value: { kind: 'number', value: '1.00' } };

function file(dayCount: number | null, cells: number): PlannedFile {
  return { dayCount, patches: new Array<CellPatch>(cells).fill(PATCH) };
}

function planOf(files: readonly PlannedFile[]): ExportPlan {
  return { files, anchors: [], overwriteFormulaColumns: [] };
}

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

function spyWarn(): MockInstance<typeof syncLog.warn> {
  return vi.spyOn(syncLog, 'warn').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('plannedDownloadNames, patch cell count', () => {
  it('refuses one file of more cells than one engine call patches, logged as too-many-cells', () => {
    const warnSpy = spyWarn();

    const thrown = captureThrow(() =>
      plannedDownloadNames(FORMAT, SOURCE, planOf([file(null, MAX_PATCH_CELLS + 1)]), CONTEXT),
    );

    expect(thrown).toBeInstanceOf(WorkbookConflictError);
    if (!(thrown instanceof WorkbookConflictError)) return;
    expect(thrown.reason).toBe('STORED_FILE_UNREADABLE');
    expect(TOO_MANY_CELLS_REASON).toBe('too-many-cells');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('workbook.stored-file-rejected', {
      page: CONTEXT.page,
      recordId: CONTEXT.recordId,
      code: null,
      reason: 'too-many-cells',
      detail: null,
    });
  });

  it('sums the cells over every planned file', () => {
    const warnSpy = spyWarn();

    const thrown = captureThrow(() =>
      plannedDownloadNames(
        FORMAT,
        SOURCE,
        planOf([file(3, FIRST_HALF), file(4, SECOND_HALF + 1)]),
        CONTEXT,
      ),
    );

    expect(thrown instanceof WorkbookConflictError ? thrown.reason : null).toBe(
      'STORED_FILE_UNREADABLE',
    );
    expect(warnSpy).toHaveBeenCalledWith('workbook.stored-file-rejected', {
      page: CONTEXT.page,
      recordId: CONTEXT.recordId,
      code: null,
      reason: 'too-many-cells',
      detail: null,
    });
  });

  it('answers the names of a plan of exactly MAX_PATCH_CELLS cells over two files', () => {
    const warnSpy = spyWarn();

    const names = plannedDownloadNames(
      FORMAT,
      SOURCE,
      planOf([file(3, FIRST_HALF), file(4, SECOND_HALF)]),
      CONTEXT,
    );

    expect(names).toEqual(['tariff-3-gunluk.xlsx', 'tariff-4-gunluk.xlsx']);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
