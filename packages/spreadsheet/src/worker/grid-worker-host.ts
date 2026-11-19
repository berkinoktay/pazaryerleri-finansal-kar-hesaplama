import { Worker } from 'node:worker_threads';

import { SpreadsheetFileError } from '../errors';
import type { SheetData } from '../grid-types';
import type { PackageCensus } from '../package-census';
import type { ResolvedPatchRequest } from '../patch/patch-request';
import type { ResolvedReadOptions } from '../read-options';
import { isGridWorkerResponse, type GridWorkerRequest, type GridWorkerResponse } from './protocol';

// Runs readUploadGrid (`run`), readUploadCensus (`census`) and patchUpload (`patch`) in
// one long-lived worker thread with a heap limit and a time limit, so a job that
// exhausts either kills only the worker, not the API:
//   - the worker is spawned on the first run, through grid-worker-entry.mjs (which
//     registers tsx), with an empty execArgv so tests and production load it alike;
//   - it is ref()ed while a job is in flight and unref()ed when idle, so it never
//     holds the process open;
//   - after a kill or a crash it is discarded, and the next run spawns a fresh one;
//   - every job settles exactly once; a settlement that ends the worker waits for
//     terminate(), so the next spawn never overlaps a dying heap;
//   - one job at a time, whatever its kind; an answer of the wrong kind, a patch
//     answer whose file count differs from the outputs sent, or one whose files repeat
//     a buffer or hold a resizable one (protocol.ts), is an invalid message.
// The limits are a backstop: one allocation larger than the remaining heap headroom
// plus about 16 MB still aborts the whole process, and memory outside the V8 heap is
// not counted, so the gate's caps stay the primary defence (constants.ts).

const WORKER_ENTRY = new URL('./grid-worker-entry.mjs', import.meta.url);
const OUT_OF_MEMORY_CODE = 'ERR_WORKER_OUT_OF_MEMORY';
const ONE_JOB_AT_A_TIME = 'GridWorkerHost runs one job at a time';

export interface GridWorkerLimits {
  readonly maxOldGenerationSizeMb: number;
  readonly maxYoungGenerationSizeMb: number;
  /** From the moment the job is posted to the worker. */
  readonly timeoutMs: number;
}

export interface GridWorkerHost {
  /**
   * The grid of `file`, read in the worker. Rejects with the SpreadsheetFileError the
   * read throws, or PAYLOAD_TOO_LARGE with `meta.reason` set when the worker's heap or
   * time limit kills it (see workerLimitReason). One job at a time.
   */
  run(file: Uint8Array, options: ResolvedReadOptions): Promise<SheetData>;
  /**
   * The package census of `file` (readUploadCensus), taken in the worker: the byte-level
   * gate runs whole, so it rejects with the SpreadsheetFileError the gate throws. Same
   * limits, kills and one-job rule as `run`.
   */
  census(file: Uint8Array, options: ResolvedReadOptions): Promise<PackageCensus>;
  /**
   * Patches `file` in the worker; null marks an output that changes nothing. Same
   * limits, kills and one-job rule as `run`.
   */
  patch(
    file: Uint8Array,
    request: ResolvedPatchRequest,
  ): Promise<(Uint8Array<ArrayBuffer> | null)[]>;
  /** Terminates the worker, if any, and waits until it is gone. */
  close(): Promise<void>;
}

/** `meta.reason` of the PAYLOAD_TOO_LARGE error a worker kill rejects with. */
export const WORKER_LIMIT_REASONS = {
  MEMORY: 'worker-memory',
  TIMEOUT: 'worker-timeout',
} as const;

type WorkerLimitReason = (typeof WORKER_LIMIT_REASONS)[keyof typeof WORKER_LIMIT_REASONS];

/** The worker limit that killed the parse `error` came from, or null when none did. */
export function workerLimitReason(error: SpreadsheetFileError): WorkerLimitReason | null {
  if (error.code !== 'PAYLOAD_TOO_LARGE') return null;
  const reason = error.meta.reason;
  if (reason === WORKER_LIMIT_REASONS.MEMORY || reason === WORKER_LIMIT_REASONS.TIMEOUT) {
    return reason;
  }
  return null;
}

/** The success answer a job waits for: a grid, a census, or one file per output it sent. */
export type ExpectedAnswer =
  | { readonly kind: 'grid' }
  | { readonly kind: 'census' }
  | { readonly kind: 'patched'; readonly outputs: number };

/**
 * Whether `response` is an answer the job may settle with: an error answer always, a
 * success only of the expected kind and size.
 */
export function answersJob(expected: ExpectedAnswer, response: GridWorkerResponse): boolean {
  switch (response.kind) {
    case 'file-error':
    case 'failure':
      return true;
    case 'grid':
      return expected.kind === 'grid';
    case 'census':
      return expected.kind === 'census';
    case 'patched':
      return expected.kind === 'patched' && response.files.length === expected.outputs;
    default: {
      const _exhaustive: never = response;
      throw new Error(`Unhandled grid worker response: ${String(_exhaustive)}`);
    }
  }
}

type SuccessAnswer = Extract<GridWorkerResponse, { readonly kind: 'grid' | 'census' | 'patched' }>;

interface Job {
  readonly id: number;
  readonly worker: Worker;
  readonly expected: ExpectedAnswer;
  readonly resolve: (answer: SuccessAnswer) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  /** Set once a settlement has started; every later event is ignored. */
  claimed: boolean;
}

const INVALID_MESSAGE = 'Workbook parse worker sent an invalid message';

function isOutOfMemory(error: Error): boolean {
  return 'code' in error && error.code === OUT_OF_MEMORY_CODE;
}

// The job only settles with an answer answersJob accepted, so the kind always matches
// in the three functions below; the throw is not reached.

function gridOf(answer: SuccessAnswer): SheetData {
  if (answer.kind === 'grid') return answer.grid;
  throw new Error('A grid job settled with another answer');
}

function censusOf(answer: SuccessAnswer): PackageCensus {
  if (answer.kind === 'census') return answer.census;
  throw new Error('A census job settled with another answer');
}

function filesOf(answer: SuccessAnswer): (Uint8Array<ArrayBuffer> | null)[] {
  if (answer.kind === 'patched') {
    return answer.files.map((file) => (file === null ? null : new Uint8Array(file)));
  }
  throw new Error('A patch job settled with another answer');
}

/** The read options a grid or census request posts: their fields only, in a plain object. */
function postedReadOptions(options: ResolvedReadOptions): ResolvedReadOptions {
  return {
    sheetName: options.sheetName,
    sheet: options.sheet,
    rowCap: options.rowCap,
    colCap: options.colCap,
    maxBytes: options.maxBytes,
  };
}

function settleWithResponse(job: Job, response: GridWorkerResponse): void {
  switch (response.kind) {
    case 'grid':
    case 'census':
    case 'patched':
      job.resolve(response);
      return;
    case 'file-error':
      job.reject(new SpreadsheetFileError(response.code, response.message, { ...response.meta }));
      return;
    case 'failure':
      job.reject(
        new Error(`Workbook parse failed in the worker: ${response.name}: ${response.message}`),
      );
      return;
    default: {
      const _exhaustive: never = response;
      throw new Error(`Unhandled grid worker response: ${String(_exhaustive)}`);
    }
  }
}

export function createGridWorkerHost(limits: GridWorkerLimits): GridWorkerHost {
  let worker: Worker | null = null;
  let job: Job | null = null;
  let nextId = 1;

  /** The in-flight job of `source`, taken for settlement; null when there is none to take. */
  function claim(source: Worker): Job | null {
    if (job === null || job.worker !== source || job.claimed) return null;
    job.claimed = true;
    clearTimeout(job.timer);
    return job;
  }

  function finish(claimed: Job, settle: () => void): void {
    if (job === claimed) job = null;
    settle();
  }

  // Terminations a kill started and close() must still wait for.
  let dying: Promise<void> = Promise.resolve();

  function discard(source: Worker): void {
    if (worker === source) worker = null;
  }

  /** Discards and terminates `source`, then rejects `claimed` once the worker is gone. */
  function killThenReject(source: Worker, claimed: Job, error: Error): void {
    discard(source);
    const settle = (): void => finish(claimed, () => claimed.reject(error));
    const gone = source.terminate().then(settle, settle);
    // close() waits for this too: the worker is already discarded, but its thread lives
    // until terminate() resolves.
    dying = Promise.all([dying, gone]).then(() => undefined);
  }

  function onMessage(source: Worker, message: unknown): void {
    const claimed = claim(source);
    if (claimed === null) return;
    if (
      !isGridWorkerResponse(message) ||
      message.id !== claimed.id ||
      !answersJob(claimed.expected, message)
    ) {
      killThenReject(source, claimed, new Error(INVALID_MESSAGE));
      return;
    }
    source.unref();
    finish(claimed, () => settleWithResponse(claimed, message));
  }

  function onMessageError(source: Worker): void {
    const claimed = claim(source);
    if (claimed === null) return;
    killThenReject(source, claimed, new Error(INVALID_MESSAGE));
  }

  function onError(source: Worker, error: Error): void {
    discard(source);
    const claimed = claim(source);
    if (claimed === null) return;
    const failure = isOutOfMemory(error)
      ? new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook parse ran out of worker memory', {
          reason: WORKER_LIMIT_REASONS.MEMORY,
          limitMb: limits.maxOldGenerationSizeMb,
        })
      : new Error('Workbook parse worker failed', { cause: error });
    killThenReject(source, claimed, failure);
  }

  function onExit(source: Worker): void {
    discard(source);
    const claimed = claim(source);
    if (claimed === null) return;
    finish(claimed, () =>
      claimed.reject(new Error('Workbook parse worker exited before answering')),
    );
  }

  function onTimeout(source: Worker): void {
    const claimed = claim(source);
    if (claimed === null) return;
    killThenReject(
      source,
      claimed,
      new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook parse exceeded the time limit', {
        reason: WORKER_LIMIT_REASONS.TIMEOUT,
        timeoutMs: limits.timeoutMs,
      }),
    );
  }

  function spawn(): Worker {
    const created = new Worker(WORKER_ENTRY, {
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb,
      },
    });
    created.on('message', (message: unknown) => onMessage(created, message));
    created.on('messageerror', () => onMessageError(created));
    created.on('error', (error: Error) => onError(created, error));
    created.on('exit', () => onExit(created));
    return created;
  }

  /**
   * Posts the request `requestOf` builds around a copy of `file` and arms the timer.
   * Throws ONE_JOB_AT_A_TIME while a job of either kind is in flight.
   */
  function start(
    file: Uint8Array,
    expected: ExpectedAnswer,
    requestOf: (id: number, bytes: ArrayBuffer) => GridWorkerRequest,
  ): Promise<SuccessAnswer> {
    if (job !== null) throw new Error(ONE_JOB_AT_A_TIME);
    const target = worker ?? spawn();
    worker = target;
    // A copy is transferred, never the caller's buffer: callers reuse it after the
    // job, and a transferred buffer is detached on the sending side.
    const copy = new Uint8Array(file.byteLength);
    copy.set(file);
    const id = nextId;
    nextId += 1;
    const request = requestOf(id, copy.buffer);
    return new Promise<SuccessAnswer>((resolve, reject) => {
      target.ref();
      try {
        target.postMessage(request, [copy.buffer]);
      } catch (e) {
        target.unref();
        throw e;
      }
      job = {
        id,
        worker: target,
        expected,
        resolve,
        reject,
        timer: setTimeout(() => onTimeout(target), limits.timeoutMs),
        claimed: false,
      };
    });
  }

  return {
    async run(file: Uint8Array, options: ResolvedReadOptions): Promise<SheetData> {
      const answer = await start(file, { kind: 'grid' }, (id, bytes) => ({
        id,
        kind: 'grid',
        bytes,
        options: postedReadOptions(options),
      }));
      return gridOf(answer);
    },

    async census(file: Uint8Array, options: ResolvedReadOptions): Promise<PackageCensus> {
      const answer = await start(file, { kind: 'census' }, (id, bytes) => ({
        id,
        kind: 'census',
        bytes,
        options: postedReadOptions(options),
      }));
      return censusOf(answer);
    },

    async patch(
      file: Uint8Array,
      request: ResolvedPatchRequest,
    ): Promise<(Uint8Array<ArrayBuffer> | null)[]> {
      const expected: ExpectedAnswer = { kind: 'patched', outputs: request.outputs.length };
      const answer = await start(file, expected, (id, bytes) => ({
        id,
        kind: 'patch',
        bytes,
        request,
      }));
      return filesOf(answer);
    },

    async close(): Promise<void> {
      const current = worker;
      if (current !== null) {
        // Discarded first, so a run() during the termination spawns a fresh worker.
        // A job still in flight is rejected by the exit handler.
        discard(current);
        await current.terminate();
      }
      await dying;
    },
  };
}
