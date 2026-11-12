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

// One parse at a time per process, at most MAX_QUEUED_PARSES in flight, none waiting
// longer than PARSE_QUEUE_MAX_WAIT_MS (see parse-queue.ts). The queue stays on the
// main thread; each parse runs in the worker host's single worker.
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
 * Runs the upload security gate and returns the raw 2D cell grid of the named sheet
 * (falling back to the first sheet), built straight from the gate's DOM (see
 * read-grid.ts), in a worker thread with a heap and a time limit. Throws
 * SpreadsheetFileError: the gate's codes, `CORRUPT_FILE` if the workbook cannot be
 * read, or `PAYLOAD_TOO_LARGE` with `meta.reason` when a worker limit kills the parse
 * (workerLimitReason). Consumers map columns by position or by their own header
 * lookup. Calls run one at a time per process; with MAX_QUEUED_PARSES calls already in
 * flight it rejects at once with `ENGINE_BUSY`, and a call that waits longer than
 * PARSE_QUEUE_MAX_WAIT_MS for its turn rejects with `ENGINE_BUSY` too.
 */
export async function readWorkbookGrid(
  file: Buffer,
  options: ReadGridOptions = {},
): Promise<SheetData> {
  const resolved = resolveReadOptions(options);
  return runParse(async () => gridWorkerHost().run(file, resolved));
}
