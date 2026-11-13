import { parentPort } from 'node:worker_threads';

import { SpreadsheetFileError } from '../errors';
import { patchUpload } from '../patch/patch-upload';
import { readUploadGrid } from '../read-grid';
import { isGridWorkerRequest, type GridWorkerRequest, type GridWorkerResponse } from './protocol';

// The grid worker's body, loaded by grid-worker-entry.mjs once tsx is registered. It
// answers each request with exactly one response; the host (grid-worker-host.ts)
// enforces the heap and time limits and rebuilds the errors on the main thread.

/** A response and the buffers posted with it in the transfer list. */
interface Answer {
  readonly response: GridWorkerResponse;
  readonly transfer: readonly ArrayBuffer[];
}

function succeed(request: GridWorkerRequest): Answer {
  const { id } = request;
  switch (request.kind) {
    case 'grid':
      return {
        response: {
          id,
          kind: 'grid',
          grid: readUploadGrid(new Uint8Array(request.bytes), request.options),
        },
        transfer: [],
      };
    case 'patch': {
      // Each changed output is a fresh Uint8Array over its own exactly-sized buffer
      // (patchUpload), so its buffer alone carries the file and can be transferred.
      const files = patchUpload(new Uint8Array(request.bytes), request.request).map((output) =>
        output === null ? null : output.buffer,
      );
      return {
        response: { id, kind: 'patched', files },
        transfer: files.filter((file): file is ArrayBuffer => file !== null),
      };
    }
    default: {
      const _exhaustive: never = request;
      throw new Error(`Unhandled grid worker request: ${String(_exhaustive)}`);
    }
  }
}

function respond(request: GridWorkerRequest): Answer {
  const { id } = request;
  try {
    return succeed(request);
  } catch (e) {
    if (e instanceof SpreadsheetFileError) {
      return {
        response: { id, kind: 'file-error', code: e.code, message: e.message, meta: e.meta },
        transfer: [],
      };
    }
    if (e instanceof Error) {
      return { response: { id, kind: 'failure', name: e.name, message: e.message }, transfer: [] };
    }
    return { response: { id, kind: 'failure', name: typeof e, message: String(e) }, transfer: [] };
  }
}

const port = parentPort;
if (port === null) throw new Error('The grid worker must run in a worker thread');

port.on('message', (message: unknown) => {
  // Uncaught, this ends the worker with an 'error' event the host settles the job on.
  if (!isGridWorkerRequest(message)) throw new Error('Grid worker received an invalid request');
  const { response, transfer } = respond(message);
  port.postMessage(response, transfer);
});
