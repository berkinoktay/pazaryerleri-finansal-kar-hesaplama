import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReadExcelFile from 'read-excel-file/node';
import type { SheetData } from 'read-excel-file/node';

import { SpreadsheetFileError } from './errors';
import type * as Guards from './guards';
import { readWorkbookGrid } from './parse';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';

// readWorkbookGrid runs one parse at a time per process. The gate step
// (prepareUploadForRead) and the reader step (readSheet) are wrapped to record the
// order they run in; the reader step is held open for a while, so a second call
// without the lock would run its gate inside the first call's reader step.
const steps = vi.hoisted(() => {
  const log: string[] = [];
  return { log, readerHoldMs: 25 };
});

vi.mock('./guards', async (importOriginal) => {
  const actual = await importOriginal<typeof Guards>();
  return {
    ...actual,
    prepareUploadForRead: (...args: Parameters<typeof actual.prepareUploadForRead>): Buffer => {
      steps.log.push('gate');
      return actual.prepareUploadForRead(...args);
    },
  };
});

vi.mock('read-excel-file/node', async (importOriginal) => {
  const actual = await importOriginal<typeof ReadExcelFile>();
  return {
    ...actual,
    readSheet: async (input: Buffer, sheet?: string): Promise<SheetData> => {
      steps.log.push('read-start');
      await new Promise((resolve) => setTimeout(resolve, steps.readerHoldMs));
      try {
        return sheet === undefined
          ? await actual.readSheet(input)
          : await actual.readSheet(input, sheet);
      } finally {
        steps.log.push('read-end');
      }
    },
  };
});

const ROWS: SheetData = [['Barkod'], ['B1']];
const FILE = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml([['Barkod'], ['B1']]) }]);

describe('readWorkbookGrid: one parse at a time', () => {
  beforeEach(() => {
    steps.log.length = 0;
  });

  it('starts the second gate only after the first reader step has ended', async () => {
    const grids = await Promise.all([readWorkbookGrid(FILE), readWorkbookGrid(FILE)]);

    expect(grids).toEqual([ROWS, ROWS]);
    expect(steps.log).toEqual(['gate', 'read-start', 'read-end', 'gate', 'read-start', 'read-end']);
  });

  it('runs the next call after a call fails', async () => {
    const [failed, next] = await Promise.allSettled([
      readWorkbookGrid(Buffer.from('not a zip')),
      readWorkbookGrid(FILE),
    ]);

    expect(failed.status).toBe('rejected');
    if (failed.status === 'rejected') {
      expect(failed.reason).toBeInstanceOf(SpreadsheetFileError);
    }
    expect(next).toEqual({ status: 'fulfilled', value: ROWS });
  });
});
