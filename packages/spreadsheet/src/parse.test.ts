import { afterEach, describe, it, expect } from 'vitest';
import { inspectWorkbookPackage, readWorkbookGrid, setGridWorkerHostForTests } from './parse';
import { SpreadsheetFileError } from './errors';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';
import { GRID_WORKER_TIMEOUT_MS, MAX_QUEUED_PARSES } from './constants';
import { UPLOAD_LIMIT_REASONS } from './patch/reasons';
import {
  createGridWorkerHost,
  workerLimitReason,
  type GridWorkerHost,
} from './worker/grid-worker-host';
import { grownFixtureWorkbook, numberRows } from '../tests/helpers/workbooks';

const QUEUE_ROWS = [['Barkod'], ['B1']];

function codeOf(e: unknown): string | null {
  return e instanceof SpreadsheetFileError ? e.code : null;
}

// Parses run one at a time per process; beyond MAX_QUEUED_PARSES calls in flight
// (running or waiting) a new call is refused at once instead of queueing.
describe('readWorkbookGrid: queue limit', () => {
  const queueFile = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml(QUEUE_ROWS) }]);
  const notAZip = Buffer.from('not a zip');

  it('allows 8 calls in flight', () => {
    expect(MAX_QUEUED_PARSES).toBe(8);
  });

  it('refuses one call more than the limit with ENGINE_BUSY without waiting', async () => {
    let settled = 0;
    const inFlight = Array.from({ length: MAX_QUEUED_PARSES }, () =>
      readWorkbookGrid(queueFile).finally(() => {
        settled += 1;
      }),
    );

    const refused = await readWorkbookGrid(queueFile).then(() => null, codeOf);

    expect(refused).toBe('ENGINE_BUSY');
    expect(settled).toBe(0);
    await expect(Promise.all(inFlight)).resolves.toEqual(
      Array.from({ length: MAX_QUEUED_PARSES }, () => QUEUE_ROWS),
    );
  });

  it('accepts a full queue again once it drains, failed calls included', async () => {
    const failing = Array.from({ length: MAX_QUEUED_PARSES }, () =>
      readWorkbookGrid(notAZip).then(() => null, codeOf),
    );
    expect(await Promise.all(failing)).toEqual(
      Array.from({ length: MAX_QUEUED_PARSES }, () => 'NOT_XLSX'),
    );

    const again = Array.from({ length: MAX_QUEUED_PARSES }, () => readWorkbookGrid(queueFile));
    await expect(Promise.all(again)).resolves.toHaveLength(MAX_QUEUED_PARSES);
  });
});

// The census runs in the worker through the same queue; the gate refuses first.
describe('inspectWorkbookPackage', () => {
  it('returns the census of an accepted file and the gate refusal of another', async () => {
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml(QUEUE_ROWS) }]);

    const census = await inspectWorkbookPackage(file);

    expect(census.relationshipTypes).toEqual([
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
    ]);
    expect(census.otherRelationshipTypes).toBe(false);
    expect(await inspectWorkbookPackage(Buffer.from('not a zip')).then(() => null, codeOf)).toBe(
      'NOT_XLSX',
    );
  });
});

// Every parse runs in the worker; a parse the worker limits kill must not hold the
// queue: the next call parses on a fresh worker.
describe('readWorkbookGrid: worker kills', () => {
  // A heap the DOM of a 5 000 x 40 sheet of numbers (about 440 MB) cannot fit in.
  const SMALL_HEAP_MB = 128;
  const SMALL_YOUNG_GENERATION_MB = 32;
  const OOM_ROWS = 5_000;
  const OOM_COLUMNS = 40;
  const MEMORY_KILL_TIMEOUT_MS = 120_000;
  const MEMORY_KILL_TEST_TIMEOUT_MS = 180_000;
  let host: GridWorkerHost | null = null;

  afterEach(async () => {
    setGridWorkerHostForTests(null);
    await host?.close();
    host = null;
  });

  function reasonOf(e: unknown): string | null {
    return e instanceof SpreadsheetFileError ? workerLimitReason(e) : null;
  }

  it(
    'parses the next call on a fresh worker after a kill',
    async () => {
      host = createGridWorkerHost({
        maxOldGenerationSizeMb: SMALL_HEAP_MB,
        maxYoungGenerationSizeMb: SMALL_YOUNG_GENERATION_MB,
        // Generous, so only memory can kill the first parse, even on a loaded machine.
        timeoutMs: MEMORY_KILL_TIMEOUT_MS,
      });
      setGridWorkerHostForTests(host);
      const tooBig = buildXlsxFixture([
        { name: 'Sheet1', xml: worksheetXml(numberRows(OOM_ROWS, OOM_COLUMNS)) },
      ]);
      const small = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml(QUEUE_ROWS) }]);

      // One after the other, not queued together: under load the killed parse can take
      // longer than the queue's wait limit, which would refuse a call queued behind it.
      // The queue's own slot release is pinned in parse-queue.test.ts.
      expect(await readWorkbookGrid(tooBig).then(() => null, reasonOf)).toBe('worker-memory');
      await expect(readWorkbookGrid(small)).resolves.toEqual(QUEUE_ROWS);
    },
    MEMORY_KILL_TEST_TIMEOUT_MS,
  );
});

// The upload gate runs in the worker; the rule a refusal names must reach the caller,
// who tells the DOM weight refusal from a size cap by it.
describe('readWorkbookGrid: refusal meta crosses the worker', () => {
  const FULL_ROWS = 5_001;
  const WIDE_COLUMNS = 64;

  it('rejects a 5 001 x 64 sheet of numbers with the DOM weight reason', async () => {
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml(numberRows(FULL_ROWS, WIDE_COLUMNS)) },
    ]);

    const refusal = readWorkbookGrid(file);

    await expect(refusal).rejects.toBeInstanceOf(SpreadsheetFileError);
    await expect(refusal).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      meta: { reason: UPLOAD_LIMIT_REASONS.DOM_WEIGHT },
    });
  });
});

// CI only: the grown workbook builds about 460 MB of DOM in the worker, which freezes
// the owner's machine. The largest real upload must parse inside the production worker
// limits with a margin.
describe.runIf(process.env.CI === 'true')('readWorkbookGrid: production limits', () => {
  const GROWN_ROWS = 5_001;

  it('reads the 5 001-row grown commission workbook in under a third of the time limit', async () => {
    const file = grownFixtureWorkbook('trendyol-commission-tariff.xlsx', GROWN_ROWS);

    const started = performance.now();
    const grid = await readWorkbookGrid(file);
    const elapsed = performance.now() - started;

    expect(grid).toHaveLength(GROWN_ROWS);
    expect(elapsed).toBeLessThan(GRID_WORKER_TIMEOUT_MS / 3);
  });
});
