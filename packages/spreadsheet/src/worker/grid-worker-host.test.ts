import { afterEach, describe, expect, it } from 'vitest';

import {
  GRID_WORKER_MAX_OLD_GENERATION_MB,
  GRID_WORKER_MAX_YOUNG_GENERATION_MB,
  GRID_WORKER_TIMEOUT_MS,
  MAX_GRID_TEXT_LENGTH,
} from '../constants';
import { SpreadsheetFileError } from '../errors';
import { resolvePatchRequest, type ResolvedPatchRequest } from '../patch/patch-request';
import { patchUpload } from '../patch/patch-upload';
import { MALFORMED_SHEET_REASONS } from '../patch/reasons';
import { assertGridTextWithinCap, readUploadGrid } from '../read-grid';
import { resolveReadOptions } from '../read-options';
import { buildXlsxFixture, worksheetXml } from '../testing/build-xlsx';
import { pinOf, readFixture } from '../../tests/helpers/fixture-pins';
import { clear, MAIN_NAMESPACE, num, text } from '../../tests/helpers/patch-helpers';
import { numberRows } from '../../tests/helpers/workbooks';
import {
  answersJob,
  createGridWorkerHost,
  workerLimitReason,
  type ExpectedAnswer,
  type GridWorkerHost,
  type GridWorkerLimits,
} from './grid-worker-host';
import { isGridWorkerRequest, isGridWorkerResponse, type GridWorkerResponse } from './protocol';

// The worker host runs readUploadGrid in a worker thread with a heap limit and a time
// limit. Each test opens its own host and closes it afterwards.

const PRODUCTION_LIMITS: GridWorkerLimits = {
  maxOldGenerationSizeMb: GRID_WORKER_MAX_OLD_GENERATION_MB,
  maxYoungGenerationSizeMb: GRID_WORKER_MAX_YOUNG_GENERATION_MB,
  timeoutMs: GRID_WORKER_TIMEOUT_MS,
};
// A heap the DOM of a 5 000 x 40 sheet of numbers (about 440 MB) cannot fit in, while
// the sheet itself passes the gate (DOM weight about 4.46 million).
const SMALL_HEAP_MB = 128;
// A memory-kill run must not hit the time limit first: under check:all load the DOM
// build up to the 128 MB heap took 42 s once, past the 30 s production limit.
const MEMORY_KILL_TIMEOUT_MS = 120_000;
const MEMORY_KILL_TEST_TIMEOUT_MS = 180_000;
const SMALL_YOUNG_GENERATION_MB = 32;
const OOM_ROWS = 5_000;
const OOM_COLUMNS = 40;
const COMMISSION_FIXTURE = 'trendyol-commission-tariff.xlsx';
const TWO_ROWS = [['Barkod'], ['B1']];
const NOT_A_ZIP = Buffer.from([1, 2, 3, 4]);
const ONE_JOB_AT_A_TIME = 'GridWorkerHost runs one job at a time';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
// The commission fixture's columns AB and AE (0-based).
const COLUMN_AB = 27;
const COLUMN_AE = 30;
const options = resolveReadOptions({});
// Changes the second row of twoRowFile.
const TWO_ROW_PATCH = resolvePatchRequest({ outputs: [[text(2, 0, 'B2')]] });

const hosts: GridWorkerHost[] = [];

function openHost(limits: GridWorkerLimits): GridWorkerHost {
  const host = createGridWorkerHost(limits);
  hosts.push(host);
  return host;
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

function twoRowFile(): Buffer {
  return buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml(TWO_ROWS) }]);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (e) {
    return e;
  }
  return null;
}

function fileErrorOf(value: unknown): SpreadsheetFileError {
  if (!(value instanceof SpreadsheetFileError)) {
    throw new Error(`expected a SpreadsheetFileError, got ${String(value)}`);
  }
  return value;
}

/** The host's patch error and the in-process one, as code and meta. */
async function patchErrorsOf(
  host: GridWorkerHost,
  file: Buffer,
  request: ResolvedPatchRequest,
): Promise<{ readonly worker: SpreadsheetFileError; readonly local: SpreadsheetFileError }> {
  const worker = fileErrorOf(await rejectionOf(host.patch(file, request)));
  const local = fileErrorOf(thrownBy(() => patchUpload(file, request)));
  return { worker, local };
}

describe('createGridWorkerHost', () => {
  it('reads a fixture grid in the worker exactly as in-process', async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    const before = Buffer.from(file);
    const host = openHost(PRODUCTION_LIMITS);

    await expect(host.run(file, options)).resolves.toEqual(readUploadGrid(file, options));
    // The worker gets a copy: the caller's buffer is neither detached nor changed.
    expect(file.equals(before)).toBe(true);
  });

  it('reads the sheet a selector picks in the worker exactly as in-process', async () => {
    const host = openHost(PRODUCTION_LIMITS);
    const file = buildXlsxFixture([
      { name: 'Help', xml: worksheetXml([['help text']]) },
      { name: 'Veri', xml: worksheetXml(TWO_ROWS) },
    ]);
    const byIndex = resolveReadOptions({ sheet: { by: 'index', index: 1 } });

    const grid = await host.run(file, byIndex);

    expect(grid).toEqual(TWO_ROWS);
    expect(grid).toEqual(readUploadGrid(file, byIndex));
    const missing = fileErrorOf(
      await rejectionOf(
        host.run(file, resolveReadOptions({ sheet: { by: 'name', name: 'Nope' } })),
      ),
    );
    expect({ code: missing.code, meta: missing.meta }).toEqual({
      code: 'SHEET_NOT_FOUND',
      meta: { by: 'name' },
    });
  });

  it('rebuilds SpreadsheetFileError with its code and meta', async () => {
    const host = openHost(PRODUCTION_LIMITS);
    const threeRows = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml([['a'], ['b'], ['c']]) },
    ]);
    const oneRowCap = resolveReadOptions({ rowCap: 1 });

    const err = fileErrorOf(await rejectionOf(host.run(threeRows, oneRowCap)));
    const local = fileErrorOf(thrownBy(() => readUploadGrid(threeRows, oneRowCap)));

    expect(err.code).toBe('ROW_CAP_EXCEEDED');
    expect(err.meta).toMatchObject({ row: 3, rowCap: 1 });
    expect({ message: err.message, meta: err.meta }).toEqual({
      message: local.message,
      meta: local.meta,
    });
    expect(fileErrorOf(await rejectionOf(host.run(NOT_A_ZIP, options))).code).toBe('NOT_XLSX');
  });

  it(
    'turns an out-of-memory kill into PAYLOAD_TOO_LARGE and recovers',
    async () => {
      const host = openHost({
        ...PRODUCTION_LIMITS,
        // Generous, so only memory can kill it, even on a loaded machine.
        timeoutMs: MEMORY_KILL_TIMEOUT_MS,
        maxOldGenerationSizeMb: SMALL_HEAP_MB,
        maxYoungGenerationSizeMb: SMALL_YOUNG_GENERATION_MB,
      });
      const tooBig = buildXlsxFixture([
        { name: 'Sheet1', xml: worksheetXml(numberRows(OOM_ROWS, OOM_COLUMNS)) },
      ]);

      const err = fileErrorOf(await rejectionOf(host.run(tooBig, options)));

      expect(err.code).toBe('PAYLOAD_TOO_LARGE');
      expect(workerLimitReason(err)).toBe('worker-memory');
      expect(err.meta).toMatchObject({ limitMb: SMALL_HEAP_MB });
      await expect(host.run(twoRowFile(), options)).resolves.toEqual(TWO_ROWS);
    },
    MEMORY_KILL_TEST_TIMEOUT_MS,
  );

  it('turns a timeout into PAYLOAD_TOO_LARGE', async () => {
    const host = openHost({ ...PRODUCTION_LIMITS, timeoutMs: 1 });

    const err = fileErrorOf(await rejectionOf(host.run(twoRowFile(), options)));

    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
    expect(workerLimitReason(err)).toBe('worker-timeout');
    expect(err.meta).toMatchObject({ timeoutMs: 1 });
  });

  it('refuses a second job while one is in flight', async () => {
    const host = openHost(PRODUCTION_LIMITS);
    const file = twoRowFile();

    const first = host.run(file, options);
    await expect(host.run(file, options)).rejects.toThrow(ONE_JOB_AT_A_TIME);
    await expect(first).resolves.toEqual(TWO_ROWS);
  });

  it('patches a fixture in the worker exactly as in-process', async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    const before = Buffer.from(file);
    const host = openHost(PRODUCTION_LIMITS);
    const request = resolvePatchRequest({
      sheetName: pinOf(COMMISSION_FIXTURE).sheetName,
      outputs: [[num(2, COLUMN_AB, '123.45'), text(2, COLUMN_AE, 'patched')]],
    });

    const patched = await host.patch(file, request);

    expect(patched).toHaveLength(1);
    expect(patched[0]).toBeInstanceOf(Uint8Array);
    expect(patched).toEqual(patchUpload(file, request));
    // The worker gets a copy: the caller's buffer is neither detached nor changed.
    expect(file.equals(before)).toBe(true);
  });

  it('returns null for an output that changes nothing', async () => {
    const host = openHost(PRODUCTION_LIMITS);
    const request = resolvePatchRequest({ outputs: [[clear(1, 5)], [num(2, 1, '5')]] });

    const patched = await host.patch(twoRowFile(), request);

    expect(patched).toHaveLength(2);
    expect(patched[0]).toBeNull();
    expect(patched[1]).toBeInstanceOf(Uint8Array);
  });

  it('rebuilds a patch error with its code and meta', async () => {
    const host = openHost(PRODUCTION_LIMITS);
    const commission = readFixture(COMMISSION_FIXTURE);
    const mismatch = resolvePatchRequest({
      sheetName: pinOf(COMMISSION_FIXTURE).sheetName,
      anchors: [{ excelRow: 2, col: 0, expected: 'NOT THE CELL TEXT' }],
      outputs: [[num(2, COLUMN_AB, '1')]],
    });

    const anchor = await patchErrorsOf(host, commission, mismatch);

    expect(anchor.worker.code).toBe('ROW_ANCHOR_MISMATCH');
    expect({ code: anchor.worker.code, meta: anchor.worker.meta }).toEqual({
      code: anchor.local.code,
      meta: anchor.local.meta,
    });

    // The reader reads this sheet; the strict lexer refuses the space in `/ >`.
    const spacedClose = buildXlsxFixture([
      {
        name: 'Sheet1',
        xml:
          `${XML_DECLARATION}<worksheet xmlns="${MAIN_NAMESPACE}"><sheetData>` +
          '<row r="1" / ><row r="2"><c r="A2"><v>7</v></c></row></sheetData></worksheet>',
      },
    ]);
    const markup = await patchErrorsOf(
      host,
      spacedClose,
      resolvePatchRequest({ outputs: [[num(2, 0, '8')]] }),
    );

    expect(markup.worker.code).toBe('MALFORMED_SHEET');
    expect(markup.worker.meta).toMatchObject({ reason: MALFORMED_SHEET_REASONS.MARKUP });
    expect({ code: markup.worker.code, meta: markup.worker.meta }).toEqual({
      code: markup.local.code,
      meta: markup.local.meta,
    });
  });

  it('turns a timeout during a patch into PAYLOAD_TOO_LARGE', async () => {
    const host = openHost({ ...PRODUCTION_LIMITS, timeoutMs: 1 });

    const err = fileErrorOf(await rejectionOf(host.patch(twoRowFile(), TWO_ROW_PATCH)));

    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
    expect(workerLimitReason(err)).toBe('worker-timeout');
    expect(err.meta).toMatchObject({ timeoutMs: 1 });
  });

  it('refuses a patch while a read is in flight, and the reverse', async () => {
    const host = openHost(PRODUCTION_LIMITS);
    const file = twoRowFile();

    const read = host.run(file, options);
    await expect(host.patch(file, TWO_ROW_PATCH)).rejects.toThrow(ONE_JOB_AT_A_TIME);
    await expect(read).resolves.toEqual(TWO_ROWS);

    const patch = host.patch(file, TWO_ROW_PATCH);
    await expect(host.run(file, options)).rejects.toThrow(ONE_JOB_AT_A_TIME);
    const patched = await patch;
    expect(patched).toHaveLength(1);
    expect(patched[0]).toBeInstanceOf(Uint8Array);
  });

  it('caps the grid text', () => {
    const half = MAX_GRID_TEXT_LENGTH / 2;

    expect(thrownBy(() => assertGridTextWithinCap([['a'.repeat(half), 'b'.repeat(half)]]))).toBe(
      null,
    );
    const err = fileErrorOf(
      thrownBy(() => assertGridTextWithinCap([['a'.repeat(half)], [1, 'b'.repeat(half + 1)]])),
    );
    expect(err.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err.meta).toEqual({ cap: MAX_GRID_TEXT_LENGTH });
  });
});

// CI only: `run` and `patch` share the kill path by construction, and filling the
// 128 MB heap once more took 42 s under load on the owner's machine.
describe.runIf(process.env.CI === 'true')(
  'createGridWorkerHost: memory kill during a patch',
  () => {
    it(
      'turns an out-of-memory kill during a patch into PAYLOAD_TOO_LARGE and recovers',
      async () => {
        const host = openHost({
          ...PRODUCTION_LIMITS,
          // Generous, so only memory can kill it, even on a loaded machine.
          timeoutMs: MEMORY_KILL_TIMEOUT_MS,
          maxOldGenerationSizeMb: SMALL_HEAP_MB,
          maxYoungGenerationSizeMb: SMALL_YOUNG_GENERATION_MB,
        });
        const tooBig = buildXlsxFixture([
          { name: 'Sheet1', xml: worksheetXml(numberRows(OOM_ROWS, OOM_COLUMNS)) },
        ]);
        const request = resolvePatchRequest({ outputs: [[num(2, 0, '1')]] });

        const err = fileErrorOf(await rejectionOf(host.patch(tooBig, request)));

        expect(err.code).toBe('PAYLOAD_TOO_LARGE');
        expect(workerLimitReason(err)).toBe('worker-memory');
        expect(err.meta).toMatchObject({ limitMb: SMALL_HEAP_MB });
        await expect(host.patch(twoRowFile(), TWO_ROW_PATCH)).resolves.toHaveLength(1);
      },
      MEMORY_KILL_TEST_TIMEOUT_MS,
    );
  },
);

describe('isGridWorkerRequest', () => {
  const bytes = new ArrayBuffer(0);

  it('accepts a sheet selector, and refuses one with a sheet name or a bad index', () => {
    const sheet = { by: 'index', index: 1 } as const;

    expect(
      isGridWorkerRequest({ id: 1, kind: 'grid', bytes, options: { ...options, sheet } }),
    ).toBe(true);
    expect(
      isGridWorkerRequest({
        id: 1,
        kind: 'grid',
        bytes,
        options: { ...options, sheet, sheetName: 'Veri' },
      }),
    ).toBe(false);
    expect(
      isGridWorkerRequest({
        id: 1,
        kind: 'grid',
        bytes,
        options: { ...options, sheet: { by: 'index', index: -1 } },
      }),
    ).toBe(false);
  });

  it('refuses a message without kind', () => {
    expect(isGridWorkerRequest({ id: 1, bytes, options })).toBe(false);
    expect(isGridWorkerRequest({ id: 1, bytes, request: TWO_ROW_PATCH })).toBe(false);
  });

  it('accepts a patch request built by resolvePatchRequest, and refuses a broken one', () => {
    const message = { id: 1, kind: 'patch', bytes, request: TWO_ROW_PATCH } as const;
    const unknownKind = { excelRow: 2, col: 0, value: { kind: 'formula', value: '1' } };

    expect(isGridWorkerRequest(message)).toBe(true);
    expect(
      isGridWorkerRequest({ ...message, request: { ...TWO_ROW_PATCH, outputs: 'none' } }),
    ).toBe(false);
    expect(
      isGridWorkerRequest({ ...message, request: { ...TWO_ROW_PATCH, outputs: [[unknownKind]] } }),
    ).toBe(false);
    expect(
      isGridWorkerRequest({
        ...message,
        request: { ...TWO_ROW_PATCH, read: { ...TWO_ROW_PATCH.read, rowCap: 0 } },
      }),
    ).toBe(false);
    // A patch body under the grid kind, and read options under the patch kind.
    expect(isGridWorkerRequest({ ...message, kind: 'grid' })).toBe(false);
    expect(isGridWorkerRequest({ id: 1, kind: 'patch', bytes, options })).toBe(false);
  });
});

// lib ES2022 declares no resizable ArrayBuffer; the runtime builds one from the options.
interface ResizableArrayBufferConstructor {
  new (byteLength: number, options: { readonly maxByteLength: number }): ArrayBuffer;
}
const ResizableArrayBuffer: ResizableArrayBufferConstructor = ArrayBuffer;

describe('isGridWorkerResponse', () => {
  it('accepts patched files only when each is an ArrayBuffer or null', () => {
    expect(
      isGridWorkerResponse({ id: 1, kind: 'patched', files: [new ArrayBuffer(1), null] }),
    ).toBe(true);
    expect(isGridWorkerResponse({ id: 1, kind: 'patched', files: [new Uint8Array(1)] })).toBe(
      false,
    );
  });

  it('refuses patched files that repeat one buffer', () => {
    const buffer = new ArrayBuffer(1);
    expect(
      isGridWorkerResponse({ id: 1, kind: 'patched', files: [buffer, null, new ArrayBuffer(1)] }),
    ).toBe(true);
    expect(isGridWorkerResponse({ id: 1, kind: 'patched', files: [null, null] })).toBe(true);
    expect(isGridWorkerResponse({ id: 1, kind: 'patched', files: [buffer, null, buffer] })).toBe(
      false,
    );
  });

  it('refuses a patched file that is a resizable buffer', () => {
    const resizable = new ResizableArrayBuffer(1, { maxByteLength: 2 });
    const resizableFlag: unknown = Reflect.get(resizable, 'resizable');
    expect(resizableFlag).toBe(true);
    expect(isGridWorkerResponse({ id: 1, kind: 'patched', files: [resizable] })).toBe(false);
  });
});

describe('answersJob', () => {
  const PATCH_JOB: ExpectedAnswer = { kind: 'patched', outputs: 2 };
  const GRID_JOB: ExpectedAnswer = { kind: 'grid' };
  const grid: GridWorkerResponse = { id: 1, kind: 'grid', grid: [] };
  const fileError: GridWorkerResponse = {
    id: 1,
    kind: 'file-error',
    code: 'NOT_XLSX',
    message: 'Not an xlsx',
    meta: {},
  };
  const failure: GridWorkerResponse = { id: 1, kind: 'failure', name: 'Error', message: 'boom' };

  function patched(files: number): GridWorkerResponse {
    return { id: 1, kind: 'patched', files: Array.from({ length: files }, () => null) };
  }

  it('settles a patch job only with one file per output sent, or with an error answer', () => {
    expect(answersJob(PATCH_JOB, patched(2))).toBe(true);
    expect(answersJob(PATCH_JOB, patched(1))).toBe(false);
    expect(answersJob(PATCH_JOB, patched(3))).toBe(false);
    expect(answersJob(PATCH_JOB, grid)).toBe(false);
    expect(answersJob(PATCH_JOB, fileError)).toBe(true);
    expect(answersJob(PATCH_JOB, failure)).toBe(true);
  });

  it('settles a grid job only with a grid, or with an error answer', () => {
    expect(answersJob(GRID_JOB, grid)).toBe(true);
    expect(answersJob(GRID_JOB, patched(2))).toBe(false);
    expect(answersJob(GRID_JOB, fileError)).toBe(true);
    expect(answersJob(GRID_JOB, failure)).toBe(true);
  });
});

describe('workerLimitReason', () => {
  it('is null for an error that is not a worker kill', () => {
    const err = new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Too large', { cap: 1 });
    expect(workerLimitReason(err)).toBeNull();
  });
});
