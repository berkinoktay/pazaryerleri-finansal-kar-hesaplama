import { Buffer } from 'node:buffer';

import { DEFAULT_COL_CAP } from '../constants';
import { resolvePatchRequest, type CellPatch } from '../patch/patch-request';
import { patchUpload } from '../patch/patch-upload';
import type { SheetSelector } from '../read-options';

// Test-only: writes cell values into a fixture workbook through the export patch path
// itself (patchUpload), sync and in-process, with no worker and no queue. Exposed to
// other workspaces through the package's "./testing" export.

export interface PatchFixtureOptions {
  readonly sheetName?: string;
  readonly sheet?: SheetSelector;
  /** Default: every column (a fixture tool overwrites whatever is there). */
  readonly overwriteFormulaColumns?: readonly number[];
}

// Every column the default read options read: the fixture is read with the default caps.
const EVERY_COLUMN: readonly number[] = Array.from({ length: DEFAULT_COL_CAP }, (_, col) => col);

/**
 * `source` with `patches` written in one output with no anchors. Returns `source`
 * itself when nothing changes, and for no patches at all. Throws what patchUpload
 * throws, and Error for an invalid request (resolvePatchRequest).
 */
export function patchFixture(
  source: Buffer,
  patches: readonly CellPatch[],
  options: PatchFixtureOptions = {},
): Buffer {
  if (patches.length === 0) return source;
  const request = resolvePatchRequest({
    ...options,
    overwriteFormulaColumns: options.overwriteFormulaColumns ?? EVERY_COLUMN,
    outputs: [patches],
  });
  const [output] = patchUpload(source, request);
  if (output === undefined) throw new Error('patchUpload answered no output for one patch list');
  if (output === null) return source;
  return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
}
