import { parentPort } from 'node:worker_threads';

import { SpreadsheetFileError } from '../errors';
import { readUploadGrid } from '../read-grid';
import { isGridWorkerRequest, type GridWorkerRequest, type GridWorkerResponse } from './protocol';

// The grid worker's body, loaded by grid-worker-entry.mjs once tsx is registered. It
// answers each request with exactly one response; the host (grid-worker-host.ts)
// enforces the heap and time limits and rebuilds the errors on the main thread.

function respond(request: GridWorkerRequest): GridWorkerResponse {
  const { id } = request;
  try {
    return {
      id,
      kind: 'grid',
      grid: readUploadGrid(new Uint8Array(request.bytes), request.options),
    };
  } catch (e) {
    if (e instanceof SpreadsheetFileError) {
      return { id, kind: 'file-error', code: e.code, message: e.message, meta: e.meta };
    }
    if (e instanceof Error) return { id, kind: 'failure', name: e.name, message: e.message };
    return { id, kind: 'failure', name: typeof e, message: String(e) };
  }
}

const port = parentPort;
if (port === null) throw new Error('The grid worker must run in a worker thread');

port.on('message', (message: unknown) => {
  // Uncaught, this ends the worker with an 'error' event the host settles the job on.
  if (!isGridWorkerRequest(message)) throw new Error('Grid worker received an invalid request');
  port.postMessage(respond(message));
});
