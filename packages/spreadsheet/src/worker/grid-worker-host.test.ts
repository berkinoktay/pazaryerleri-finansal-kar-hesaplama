import { afterEach, describe, expect, it } from 'vitest';

import {
  GRID_WORKER_MAX_OLD_GENERATION_MB,
  GRID_WORKER_MAX_YOUNG_GENERATION_MB,
  GRID_WORKER_TIMEOUT_MS,
  MAX_GRID_TEXT_LENGTH,
} from '../constants';
import { SpreadsheetFileError } from '../errors';
import { assertGridTextWithinCap, readUploadGrid } from '../read-grid';
import { resolveReadOptions } from '../read-options';
import { buildXlsxFixture, worksheetXml } from '../testing/build-xlsx';
import { readFixture } from '../../tests/helpers/fixture-pins';
import { numberRows } from '../../tests/helpers/workbooks';
import {
  createGridWorkerHost,
  workerLimitReason,
  type GridWorkerHost,
  type GridWorkerLimits,
} from './grid-worker-host';

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
const SMALL_YOUNG_GENERATION_MB = 32;
const OOM_ROWS = 5_000;
const OOM_COLUMNS = 40;
const COMMISSION_FIXTURE = 'trendyol-commission-tariff.xlsx';
const TWO_ROWS = [['Barkod'], ['B1']];
const NOT_A_ZIP = Buffer.from([1, 2, 3, 4]);
const options = resolveReadOptions({});

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

describe('createGridWorkerHost', () => {
  it('reads a fixture grid in the worker exactly as in-process', async () => {
    const file = readFixture(COMMISSION_FIXTURE);
    const before = Buffer.from(file);
    const host = openHost(PRODUCTION_LIMITS);

    await expect(host.run(file, options)).resolves.toEqual(readUploadGrid(file, options));
    // The worker gets a copy: the caller's buffer is neither detached nor changed.
    expect(file.equals(before)).toBe(true);
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

  it('turns an out-of-memory kill into PAYLOAD_TOO_LARGE and recovers', async () => {
    const host = openHost({
      ...PRODUCTION_LIMITS,
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
  });

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
    await expect(host.run(file, options)).rejects.toThrow('GridWorkerHost runs one job at a time');
    await expect(first).resolves.toEqual(TWO_ROWS);
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

describe('workerLimitReason', () => {
  it('is null for an error that is not a worker kill', () => {
    const err = new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Too large', { cap: 1 });
    expect(workerLimitReason(err)).toBeNull();
  });
});
