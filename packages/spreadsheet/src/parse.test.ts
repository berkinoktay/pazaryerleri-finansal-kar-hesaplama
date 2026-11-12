import { afterEach, describe, it, expect } from 'vitest';
import { readWorkbookGrid, setGridWorkerHostForTests } from './parse';
import { SpreadsheetFileError } from './errors';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';
import { GRID_WORKER_TIMEOUT_MS, MAX_QUEUED_PARSES } from './constants';
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

// Every parse runs in the worker; a parse the worker limits kill must not hold the
// queue: the next call parses on a fresh worker.
describe('readWorkbookGrid: worker kills', () => {
  // A heap the DOM of a 5 000 x 40 sheet of numbers (about 440 MB) cannot fit in.
  const SMALL_HEAP_MB = 128;
  const SMALL_YOUNG_GENERATION_MB = 32;
  const OOM_ROWS = 5_000;
  const OOM_COLUMNS = 40;
  let host: GridWorkerHost | null = null;

  afterEach(async () => {
    setGridWorkerHostForTests(null);
    await host?.close();
    host = null;
  });

  function reasonOf(e: unknown): string | null {
    return e instanceof SpreadsheetFileError ? workerLimitReason(e) : null;
  }

  it('releases the queue slot after a worker kill', async () => {
    host = createGridWorkerHost({
      maxOldGenerationSizeMb: SMALL_HEAP_MB,
      maxYoungGenerationSizeMb: SMALL_YOUNG_GENERATION_MB,
      timeoutMs: GRID_WORKER_TIMEOUT_MS,
    });
    setGridWorkerHostForTests(host);
    const tooBig = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml(numberRows(OOM_ROWS, OOM_COLUMNS)) },
    ]);
    const small = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml(QUEUE_ROWS) }]);

    const killed = readWorkbookGrid(tooBig).then(() => null, reasonOf);
    const next = readWorkbookGrid(small);

    expect(await killed).toBe('worker-memory');
    await expect(next).resolves.toEqual(QUEUE_ROWS);
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
