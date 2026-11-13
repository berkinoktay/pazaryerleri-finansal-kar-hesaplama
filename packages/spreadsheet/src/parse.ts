import {
  GRID_WORKER_MAX_OLD_GENERATION_MB,
  GRID_WORKER_MAX_YOUNG_GENERATION_MB,
  GRID_WORKER_TIMEOUT_MS,
  MAX_QUEUED_PARSES,
  PARSE_QUEUE_MAX_WAIT_MS,
} from './constants';
import type { SheetData } from './grid-types';
import { createParseQueue } from './parse-queue';
import { resolveReadOptions, type ReadGridOptions } from './read-options';
import { createGridWorkerHost, type GridWorkerHost } from './worker/grid-worker-host';

// One job at a time per process, at most MAX_QUEUED_PARSES in flight, none waiting
// longer than PARSE_QUEUE_MAX_WAIT_MS (see parse-queue.ts). Reads and patches share
// this one queue and the one host below, so the limits bound them together. The queue
// stays on the main thread; each job runs in the worker host's single worker.
const runParse = createParseQueue({
  maxInFlight: MAX_QUEUED_PARSES,
  maxWaitMs: PARSE_QUEUE_MAX_WAIT_MS,
});

// Created on the first parse; its worker is spawned on its first run.
let defaultHost: GridWorkerHost | null = null;
let hostForTests: GridWorkerHost | null = null;

function gridWorkerHost(): GridWorkerHost {
  if (hostForTests !== null) return hostForTests;
  defaultHost ??= createGridWorkerHost({
    maxOldGenerationSizeMb: GRID_WORKER_MAX_OLD_GENERATION_MB,
    maxYoungGenerationSizeMb: GRID_WORKER_MAX_YOUNG_GENERATION_MB,
    timeoutMs: GRID_WORKER_TIMEOUT_MS,
  });
  return defaultHost;
}

/**
 * Test seam: parses that start from now on run on `host`; `null` restores the lazy
 * default host. Not exported from the package.
 */
export function setGridWorkerHostForTests(host: GridWorkerHost | null): void {
  hostForTests = host;
}

/**
 * Runs `job` on the process's grid worker host once its turn in the queue comes (the
 * one queue reads and patches share). Rejects with SpreadsheetFileError ENGINE_BUSY
 * when the queue is full or the job waited too long, or with what `job` rejects with.
 * Not exported from the package.
 */
export async function runOnGridWorker<T>(job: (host: GridWorkerHost) => Promise<T>): Promise<T> {
  return runParse(async () => job(gridWorkerHost()));
}

/**
 * Runs the upload security gate and returns the raw 2D cell grid of one sheet, built
 * straight from the gate's DOM (see read-grid.ts), in a worker thread with a heap and
 * a time limit. The sheet:
 *   - `sheet` (strict): the first sheet with that exact name, or the sheet at that
 *     index among the workbook's named sheets (hidden ones included); none →
 *     `SHEET_NOT_FOUND`, and a sheet that breaks a reader rule → `CORRUPT_FILE`,
 *     never another sheet;
 *   - `sheetName` (legacy): the named sheet, falling back to the first sheet when it
 *     is missing or breaks a reader rule;
 *   - neither: the first sheet.
 * Passing both `sheet` and `sheetName`, or an index that is not a non-negative
 * integer, throws Error before the call is queued (a caller bug). Throws
 * SpreadsheetFileError: the gate's codes, `SHEET_NOT_FOUND`, `CORRUPT_FILE` if the
 * workbook cannot be read, or `PAYLOAD_TOO_LARGE` with `meta.reason` when a worker
 * limit kills the parse (workerLimitReason). Consumers map columns by position or by their own header
 * lookup. Calls run one at a time per process, in the queue patchWorkbook shares; with
 * MAX_QUEUED_PARSES calls of either kind already in flight it rejects at once with
 * `ENGINE_BUSY`, and a call that waits longer than PARSE_QUEUE_MAX_WAIT_MS for its turn
 * rejects with `ENGINE_BUSY` too.
 */
export async function readWorkbookGrid(
  file: Buffer,
  options: ReadGridOptions = {},
): Promise<SheetData> {
  const resolved = resolveReadOptions(options);
  return runOnGridWorker(async (host) => host.run(file, resolved));
}
