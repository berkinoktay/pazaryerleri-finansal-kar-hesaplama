import { Buffer } from 'node:buffer';

import { runOnGridWorker } from '../parse';
import {
  resolvePatchRequest,
  type CellPatch,
  type PatchWorkbookOptions,
  type ResolvedPatchRequest,
} from './patch-request';

// The public export patch path: the request is validated on the main thread, only the
// outputs that patch something are sent, and the job runs in the parse worker through
// the queue reads use (runOnGridWorker). The answers come back by position.

function patchesSomething(patches: readonly CellPatch[]): boolean {
  return patches.length > 0;
}

/**
 * One Buffer per `options.outputs` entry, in order. An output that changes nothing is
 * `file` itself. Throws Error for an invalid request (before queueing). Rejects with
 * SpreadsheetFileError: every code a read can raise, plus MALFORMED_SHEET,
 * UNSUPPORTED_ENCODING, ROW_NOT_FOUND, ROW_ANCHOR_MISMATCH, ENGINE_BUSY, and
 * PAYLOAD_TOO_LARGE with a worker or a patch reason.
 */
export async function patchWorkbook(
  file: Buffer,
  options: PatchWorkbookOptions,
): Promise<Buffer[]> {
  const request = resolvePatchRequest(options);
  const sent = request.outputs.filter(patchesSomething);
  if (sent.length === 0) return request.outputs.map(() => file);

  const job: ResolvedPatchRequest = { ...request, outputs: sent };
  const answers = await runOnGridWorker(async (host) => host.patch(file, job));
  // Checked before mapping: a missing answer must never read as "unchanged", which
  // would hand back the stored upload as if it had been patched.
  if (answers.length !== sent.length) {
    throw new Error(`Patch worker answered ${answers.length} files for ${sent.length} outputs`);
  }

  const files: Buffer[] = [];
  let next = 0;
  for (const patches of request.outputs) {
    if (!patchesSomething(patches)) {
      files.push(file);
      continue;
    }
    const answer = answers[next];
    next += 1;
    // Not reached after the count check above.
    if (answer === undefined) throw new Error('Patch worker answered too few files');
    files.push(
      answer === null ? file : Buffer.from(answer.buffer, answer.byteOffset, answer.byteLength),
    );
  }
  return files;
}
