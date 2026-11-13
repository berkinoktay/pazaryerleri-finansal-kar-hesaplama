import { afterEach, describe, expect, it } from 'vitest';

import { pinOf, readFixture } from '../../tests/helpers/fixture-pins';
import { num, text } from '../../tests/helpers/patch-helpers';
import { grownFixtureWorkbook } from '../../tests/helpers/workbooks';
import { GRID_WORKER_TIMEOUT_MS, MAX_PATCH_OUTPUTS, MAX_QUEUED_PARSES } from '../constants';
import { SpreadsheetFileError } from '../errors';
import type { CellValue, SheetData } from '../grid-types';
import { readWorkbookGrid, setGridWorkerHostForTests } from '../parse';
import { cellKey } from '../sheet-meta';
import { buildXlsxFixture, worksheetXml } from '../testing/build-xlsx';
import type { GridWorkerHost } from '../worker/grid-worker-host';
import type { CellPatch, PatchWorkbookOptions, ResolvedPatchRequest } from './patch-request';
import { patchUpload } from './patch-upload';
import { patchWorkbook } from './patch-workbook';
import { entryContent, readZipLayout } from './raw-zip';
import { cellKeysOf, indexWorksheet, type SheetIndex } from './sheet-index';
import { valueAt } from './xml-lexer';

// patchWorkbook validates the request on the main thread, sends only the outputs that
// patch something to the worker, through the queue reads use, and maps the answers
// back by position. Tests that swap the worker host restore the default afterwards.

const COMMISSION_FIXTURE = 'trendyol-commission-tariff.xlsx';
const DISCOUNT_FIXTURE = 'trendyol-discount-products.xlsx';
// The commission fixture's columns AB and AE (0-based).
const COLUMN_AB = 27;
const COLUMN_AE = 30;
const QUEUE_ROWS = [['Barkod'], ['B1']];
const SMALL_PATCH: PatchWorkbookOptions = { outputs: [[text(2, 0, 'B2')]] };

const commissionPin = pinOf(COMMISSION_FIXTURE);
const commissionRead = { sheetName: commissionPin.sheetName };

afterEach(() => {
  setGridWorkerHostForTests(null);
});

interface RecordingHost {
  readonly host: GridWorkerHost;
  /** One entry per job the host was asked to run. */
  readonly jobs: string[];
}

/** A host whose every job throws: a test that uses it proves no job ran. */
function throwingHost(): RecordingHost {
  const jobs: string[] = [];
  const host: GridWorkerHost = {
    run(): Promise<SheetData> {
      jobs.push('run');
      throw new Error('No read may run on this host');
    },
    patch(): Promise<(Uint8Array<ArrayBuffer> | null)[]> {
      jobs.push('patch');
      throw new Error('No patch may run on this host');
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
  return { host, jobs };
}

/** A host whose patch answers `extra` items more than the outputs it was sent (fewer when negative). */
function miscountingHost(extra: number): GridWorkerHost {
  return {
    run(): Promise<SheetData> {
      throw new Error('No read may run on this host');
    },
    patch(_file, request): Promise<(Uint8Array<ArrayBuffer> | null)[]> {
      return Promise.resolve(Array.from({ length: request.outputs.length + extra }, () => null));
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}

interface InProcessHost {
  readonly host: GridWorkerHost;
  /** Every patch request the host was sent, in order. */
  readonly requests: ResolvedPatchRequest[];
}

/** A host that records each patch request and answers it in-process with patchUpload, the job the worker runs. */
function inProcessHost(): InProcessHost {
  const requests: ResolvedPatchRequest[] = [];
  const host: GridWorkerHost = {
    run(): Promise<SheetData> {
      throw new Error('No read may run on this host');
    },
    patch(file, request): Promise<(Uint8Array<ArrayBuffer> | null)[]> {
      requests.push(request);
      return Promise.resolve(patchUpload(file, request));
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
  return { host, requests };
}

function codeOf(e: unknown): string | null {
  return e instanceof SpreadsheetFileError ? e.code : null;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

/** `grid` with the cell at `row`, `col` set to `value`. */
function withCell(grid: SheetData, row: number, col: number, value: CellValue): SheetData {
  return grid.map((cells, at) =>
    at === row ? cells.map((cell, c) => (c === col ? value : cell)) : cells,
  );
}

describe('patchWorkbook: outputs', () => {
  it('returns the stored file for every output when every output is empty, with no job', async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    const { host, jobs } = throwingHost();
    setGridWorkerHostForTests(host);

    const outputs = await patchWorkbook(file, { outputs: [[], []] });

    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toBe(file);
    expect(outputs[1]).toBe(file);
    expect(jobs).toEqual([]);
  });

  it('sends only the non-empty outputs and maps the answers back by position', async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    const first = num(2, COLUMN_AB, '123.45');
    const second = num(2, COLUMN_AB, '678.9');
    const { host, requests } = inProcessHost();
    setGridWorkerHostForTests(host);

    const outputs = await patchWorkbook(file, {
      ...commissionRead,
      outputs: [[], [first], [], [second]],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.outputs).toEqual([[first], [second]]);
    expect(outputs).toHaveLength(4);
    expect(outputs[0]).toBe(file);
    expect(outputs[2]).toBe(file);
    const [, patchedFirst, , patchedSecond] = outputs;
    if (patchedFirst === undefined || patchedSecond === undefined) throw new Error('no outputs');
    expect(patchedFirst).not.toBe(file);
    expect(patchedSecond).not.toBe(file);
    // Read back through the worker, not the in-process host.
    setGridWorkerHostForTests(null);
    const source = await readWorkbookGrid(file, commissionRead);
    expect(await readWorkbookGrid(patchedFirst, commissionRead)).toEqual(
      withCell(source, 1, COLUMN_AB, 123.45),
    );
    expect(await readWorkbookGrid(patchedSecond, commissionRead)).toEqual(
      withCell(source, 1, COLUMN_AB, 678.9),
    );
  });

  it('rejects an invalid request before anything is queued', async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    const { host, jobs } = throwingHost();
    setGridWorkerHostForTests(host);

    await expect(patchWorkbook(file, { outputs: [[num(2, COLUMN_AB, '1e-7')]] })).rejects.toThrow(
      'Invalid patch request: ',
    );
    expect(jobs).toEqual([]);
  });

  it('rejects a short answer and never hands back the stored file for it', async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    setGridWorkerHostForTests(miscountingHost(-1));

    const error = await rejectionOf(
      patchWorkbook(file, {
        outputs: [[num(2, COLUMN_AB, '1')], [num(2, COLUMN_AB, '2')]],
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SpreadsheetFileError);
  });

  it('rejects an overlong answer', async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    setGridWorkerHostForTests(miscountingHost(1));

    await expect(
      patchWorkbook(file, {
        outputs: [[num(2, COLUMN_AB, '1')], [num(2, COLUMN_AB, '2')]],
      }),
    ).rejects.toThrow('Patch worker answered 3 files for 2 outputs');
  });

  it("leaves the caller's Buffer unchanged and readable", async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    const before = Buffer.from(file);

    const [patched] = await patchWorkbook(file, {
      ...commissionRead,
      outputs: [[num(2, COLUMN_AB, '123.45')]],
    });

    expect(patched).toBeInstanceOf(Buffer);
    expect(file.equals(before)).toBe(true);
    await expect(readWorkbookGrid(file, commissionRead)).resolves.toHaveLength(commissionPin.rows);
  });
});

// Reads and patches share one queue and one worker host: MAX_QUEUED_PARSES calls of
// either kind fill it.
describe('patchWorkbook: one queue with reads', () => {
  const small = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml(QUEUE_ROWS) }]);

  it('refuses a patch while MAX_QUEUED_PARSES reads are in flight', async () => {
    const reads = Array.from({ length: MAX_QUEUED_PARSES }, () => readWorkbookGrid(small));

    expect(await patchWorkbook(small, SMALL_PATCH).then(() => null, codeOf)).toBe('ENGINE_BUSY');
    await expect(Promise.all(reads)).resolves.toEqual(
      Array.from({ length: MAX_QUEUED_PARSES }, () => QUEUE_ROWS),
    );
  });

  it('rejects an invalid patch request without queueing it, even with the queue full', async () => {
    const reads = Array.from({ length: MAX_QUEUED_PARSES }, () => readWorkbookGrid(small));

    // Validated before the queue is asked: the caller bug, never ENGINE_BUSY.
    await expect(patchWorkbook(small, { outputs: [[num(2, 0, '1e-7')]] })).rejects.toThrow(
      'Invalid patch request: ',
    );
    await expect(Promise.all(reads)).resolves.toEqual(
      Array.from({ length: MAX_QUEUED_PARSES }, () => QUEUE_ROWS),
    );
  });

  it('refuses a read while MAX_QUEUED_PARSES patches are in flight', async () => {
    const patches = Array.from({ length: MAX_QUEUED_PARSES }, () =>
      patchWorkbook(small, SMALL_PATCH),
    );

    expect(await readWorkbookGrid(small).then(() => null, codeOf)).toBe('ENGINE_BUSY');
    const settled = await Promise.all(patches);
    expect(settled).toHaveLength(MAX_QUEUED_PARSES);
    for (const [output] of settled) expect(output).toBeInstanceOf(Buffer);
  });
});

describe('patchWorkbook: anchors', () => {
  const pin = pinOf(DISCOUNT_FIXTURE);
  const file = readFixture(DISCOUNT_FIXTURE);
  // The discount fixture's barcode column (0-based) and a free column to write.
  const BARCODE_COLUMN = 4;
  const WRITTEN_COLUMN = 8;

  function anchored(expected: string): PatchWorkbookOptions {
    return {
      sheetName: pin.sheetName,
      anchors: [{ excelRow: 2, col: BARCODE_COLUMN, expected }],
      outputs: [[text(2, WRITTEN_COLUMN, 'x')]],
    };
  }

  it('patches when the anchor reads as given', async () => {
    const [output] = await patchWorkbook(file, anchored(pin.firstBarcode));

    expect(output).toBeInstanceOf(Buffer);
    expect(output).not.toBe(file);
  });

  it('rejects an anchor that reads otherwise with ROW_ANCHOR_MISMATCH', async () => {
    const error = await rejectionOf(patchWorkbook(file, anchored('OTHER')));

    if (!(error instanceof SpreadsheetFileError)) throw new Error(`unexpected ${String(error)}`);
    expect(error.code).toBe('ROW_ANCHOR_MISMATCH');
    expect(error.meta.rows).toEqual([2]);
  });
});

// CI only: the grown workbook builds about 460 MB of DOM in the worker, which freezes
// the owner's machine. The 30 s worker limit is proven at the output cap, not below it.
describe.runIf(process.env.CI === 'true')('patchWorkbook: production limits', () => {
  const GROWN_ROWS = 5_001;
  const PRODUCTION_LIMITS_TEST_TIMEOUT_MS = 180_000;
  const TEXT_VALUE = 'patched';
  // The commission fixture's worksheet part, the one grownFixtureWorkbook grows.
  const SHEET_PART = 'xl/worksheets/sheet1.xml';
  const decoder = new TextDecoder();

  interface RawCell {
    /** The cell's start tag. */
    readonly tag: string;
    /** Everything after the start tag, its end tag included. */
    readonly rest: string;
  }

  /** The number output `output` writes into column AB. */
  function numberOf(output: number): string {
    return `${output + 1}.25`;
  }

  /** The index of the worksheet part of `output`, taken from its directory entry with a bounded inflate. */
  function sheetIndexOf(output: Uint8Array): SheetIndex {
    const entry = readZipLayout(output).entries.find((candidate) => candidate.name === SHEET_PART);
    if (entry === undefined) throw new Error(`entry missing: ${SHEET_PART}`);
    return indexWorksheet(entryContent(output, entry));
  }

  /** The raw text of the cell at `excelRow` and 0-based `col`. */
  function rawCell(index: SheetIndex, excelRow: number, col: number): RawCell {
    const at = cellKeysOf(index).indexOf(cellKey(excelRow, col + 1));
    if (at === -1) throw new Error(`no cell at row ${excelRow}, column ${col}`);
    const tagEnd = valueAt(index.cellTagEnd, at);
    return {
      tag: decoder.decode(index.bytes.subarray(valueAt(index.cellStart, at), tagEnd)),
      rest: decoder.decode(index.bytes.subarray(tagEnd, valueAt(index.cellEnd, at))),
    };
  }

  // Checked on the raw worksheet part, not through readWorkbookGrid: the grown source
  // already sits at 98% of the gate's DOM-weight cap, and the written values push an
  // output past it, so a re-read through the import caps is refused. Outputs are not
  // bound by the import caps (see patch-upload.ts); the layout, the bounded inflate and
  // the worksheet index read the part without them.
  function expectLastRowPatched(output: Uint8Array, outputIndex: number): void {
    const index = sheetIndexOf(output);
    expect(rawCell(index, GROWN_ROWS, COLUMN_AB).rest).toBe(`<v>${numberOf(outputIndex)}</v></c>`);
    const textCell = rawCell(index, GROWN_ROWS, COLUMN_AE);
    expect(textCell.tag).toContain(' t="inlineStr"');
    expect(textCell.rest).toBe(`<is><t>${TEXT_VALUE}</t></is></c>`);
  }

  /** Columns AB and AE of every data row. */
  function everyDataRow(output: number): CellPatch[] {
    const patches: CellPatch[] = [];
    for (let excelRow = 2; excelRow <= GROWN_ROWS; excelRow += 1) {
      patches.push(num(excelRow, COLUMN_AB, numberOf(output)));
      patches.push(text(excelRow, COLUMN_AE, TEXT_VALUE));
    }
    return patches;
  }

  it(
    'patches every data row of the grown commission workbook into MAX_PATCH_OUTPUTS files in under half the time limit',
    async () => {
      const file = grownFixtureWorkbook(COMMISSION_FIXTURE, GROWN_ROWS);
      const outputs = Array.from({ length: MAX_PATCH_OUTPUTS }, (_, output) =>
        everyDataRow(output),
      );

      const started = performance.now();
      const patched = await patchWorkbook(file, { ...commissionRead, outputs });
      const elapsed = performance.now() - started;

      expect(patched).toHaveLength(MAX_PATCH_OUTPUTS);
      expect(elapsed).toBeLessThan(GRID_WORKER_TIMEOUT_MS / 2);
      const first = patched[0];
      const last = patched[MAX_PATCH_OUTPUTS - 1];
      if (first === undefined || last === undefined) throw new Error('missing outputs');
      expectLastRowPatched(first, 0);
      expectLastRowPatched(last, MAX_PATCH_OUTPUTS - 1);
    },
    PRODUCTION_LIMITS_TEST_TIMEOUT_MS,
  );
});
