import { Buffer } from 'node:buffer';

import { MAX_ERROR_CAUSE_LENGTH, MAX_PATCH_OUTPUT_TOTAL_BYTES } from '../constants';
import { SpreadsheetFileError } from '../errors';
import { openUpload, type UploadParts } from '../guards';
import type { GridCaps } from '../part-checks';
import { readSheet, type SheetReading } from '../read-grid';
import { CONTENT_TYPES_PART, WORKBOOK_RELS_PART } from '../workbook-parts';
import { assertAnchorsMatch } from './anchors';
import { foldAsciiCase, planCalcChainRemoval } from './calc-chain';
import { assertTargetsOutsideMerges } from './merged-ranges';
import type { ResolvedPatchRequest } from './patch-request';
import { applyCellPatches, patchedPartCap, type WorksheetPatchOptions } from './patch-worksheet';
import {
  entryContent,
  readZipLayout,
  rewriteZip,
  type ZipChange,
  type ZipEntry,
  type ZipLayout,
} from './raw-zip';
import { MALFORMED_SHEET_REASONS, PATCH_LIMIT_REASONS, ZIP_REJECT_REASONS } from './reasons';
import { cellKeysOf, indexWorksheet } from './sheet-index';

// The export patch path, sync and in-process: one stored upload in, one archive per
// output out. Cheap checks run before the DOM, and nothing is written before every
// check has passed:
//   1. the gate (openUpload): the same checks a grid read runs;
//   2. the zip layout (readZipLayout), then the view check: every part the gate
//      returned equals the directory's entry of that name. Neither builds a DOM, so a
//      stored file the layout refuses costs no full parse;
//   3. the reader (readSheet) on the gate's parts; its grid never leaves the job, so
//      the grid text cap does not apply;
//   4. the caller's anchors, on the reader's grid;
//   5. the converted part must not be one the rewrite may also replace;
//   6. the worksheet index on the same bytes, which must list the cells the reader
//      placed, in the same order (the index assumes the reader's strict parse passed);
//   7. no target inside a merged range;
//   8. each output's patches, applied to the index;
//   9. a changed output is the archive with the converted part replaced and, when a
//      formula was overwritten, the calcChain cut; the bytes of all outputs together
//      are capped.
// The patched part is built from the bytes the reader parsed, never from the
// directory's copy.

// Every relationships part ends with this, the package's root relationships included;
// a calcChain path never drops one.
const RELATIONSHIPS_PART_SUFFIX = '.rels';
const DROP: ZipChange = { kind: 'drop' };

function entryMeta(name: string): string {
  return name.slice(0, MAX_ERROR_CAUSE_LENGTH);
}

function viewMismatch(name: string, detail: string): SpreadsheetFileError {
  return new SpreadsheetFileError('CORRUPT_FILE', `Zip entry of a reader part ${detail}`, {
    reason: ZIP_REJECT_REASONS.VIEW_MISMATCH,
    entry: entryMeta(name),
  });
}

function entriesByName(layout: ZipLayout): Map<string, ZipEntry> {
  const entries = new Map<string, ZipEntry>();
  for (const entry of layout.entries) entries.set(entry.name, entry);
  return entries;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);
}

/**
 * Throws SpreadsheetFileError MALFORMED_SHEET `{ reason: 'reader-mismatch',
 * readerCells, indexCells }` unless the reader and the index list the same cell keys
 * in the same order.
 */
export function assertSameCells(readerKeys: readonly number[], indexKeys: readonly number[]): void {
  let same = readerKeys.length === indexKeys.length;
  for (let at = 0; same && at < readerKeys.length; at += 1) {
    same = readerKeys[at] === indexKeys[at];
  }
  if (same) return;
  throw new SpreadsheetFileError(
    'MALFORMED_SHEET',
    'Worksheet part places other cells for the reader than for the patcher',
    {
      reason: MALFORMED_SHEET_REASONS.READER_MISMATCH,
      readerCells: readerKeys.length,
      indexCells: indexKeys.length,
    },
  );
}

/**
 * Throws SpreadsheetFileError CORRUPT_FILE `{ reason: 'zip-view-mismatch', entry }`
 * unless every part of `parts` equals the content of the directory's entry of that
 * name. Every entry must exist and declare its part's length before anything is
 * inflated; the inflate is bounded by that length (entryContent).
 */
export function assertSameViews(file: Uint8Array, layout: ZipLayout, parts: UploadParts): void {
  const entries = entriesByName(layout);
  const pairs: (readonly [ZipEntry, Uint8Array])[] = [];
  for (const [name, bytes] of Object.entries(parts)) {
    const entry = entries.get(name);
    if (entry === undefined) throw viewMismatch(name, 'is missing from the central directory');
    if (entry.uncompressedSize !== bytes.length) {
      throw viewMismatch(name, 'declares another length than the part the gate read');
    }
    pairs.push([entry, bytes]);
  }
  for (const [entry, bytes] of pairs) {
    if (!sameBytes(entryContent(file, entry), bytes)) {
      throw viewMismatch(entry.name, 'holds other bytes than the part the gate read');
    }
  }
}

/**
 * Throws SpreadsheetFileError PAYLOAD_TOO_LARGE `{ reason: 'patch-output', cap }` when
 * `totalBytes` exceeds MAX_PATCH_OUTPUT_TOTAL_BYTES.
 */
export function assertOutputBudget(totalBytes: number): void {
  if (totalBytes <= MAX_PATCH_OUTPUT_TOTAL_BYTES) return;
  throw new SpreadsheetFileError(
    'PAYLOAD_TOO_LARGE',
    `Patched outputs exceed ${MAX_PATCH_OUTPUT_TOTAL_BYTES}B together`,
    { reason: PATCH_LIMIT_REASONS.OUTPUT, cap: MAX_PATCH_OUTPUT_TOTAL_BYTES },
  );
}

/** MALFORMED_SHEET `target-part` when the converted part is also a part the rewrite may replace. */
function assertPatchablePart(reading: SheetReading): void {
  if (!reading.partIsBookPart && reading.partPath !== CONTENT_TYPES_PART) return;
  throw new SpreadsheetFileError(
    'MALFORMED_SHEET',
    'Worksheet part is also a part the patch may rewrite',
    { reason: MALFORMED_SHEET_REASONS.TARGET_PART },
  );
}

/**
 * CORRUPT_FILE `package-part` for a calcChain path that names a part every output
 * needs, compared folding ASCII case (the way OPC compares part names): the converted part,
 * any reader part, the content types, or any relationships part. A Target is free
 * text; dropping such a path would lose that part, or put a drop and a replace on
 * the same entry.
 */
function assertDroppable(paths: readonly string[], parts: UploadParts, partPath: string): void {
  const needed = new Set<string>([foldAsciiCase(partPath), foldAsciiCase(CONTENT_TYPES_PART)]);
  for (const name of Object.keys(parts)) needed.add(foldAsciiCase(name));
  for (const path of paths) {
    const folded = foldAsciiCase(path);
    if (!needed.has(folded) && !folded.endsWith(RELATIONSHIPS_PART_SUFFIX)) continue;
    throw new SpreadsheetFileError(
      'CORRUPT_FILE',
      'Workbook calcChain relationship names a part the output needs',
      { reason: ZIP_REJECT_REASONS.PACKAGE_PART, entry: entryMeta(path) },
    );
  }
}

/**
 * The changes that cut the calcChain: the workbook rels and the content types without
 * it, and a drop of each calcChain path that is exactly an entry name. Empty when the
 * workbook rels name no calcChain part. The content types come from the directory's
 * view (the gate keeps no copy of that part), bounded by entryContent and only lexed.
 */
function calcChainChanges(
  file: Uint8Array,
  entries: ReadonlyMap<string, ZipEntry>,
  parts: UploadParts,
  partPath: string,
): ReadonlyMap<string, ZipChange> {
  const workbookRels = parts[WORKBOOK_RELS_PART];
  const contentTypes = entries.get(CONTENT_TYPES_PART);
  // The gate requires both; this is not reached by a file that passed it.
  if (workbookRels === undefined || contentTypes === undefined) {
    throw new Error('The gate passed an upload without workbook rels or content types');
  }
  const changes = new Map<string, ZipChange>();
  const plan = planCalcChainRemoval(workbookRels, entryContent(file, contentTypes));
  if (plan === null) return changes;
  assertDroppable(plan.paths, parts, partPath);
  changes.set(WORKBOOK_RELS_PART, { kind: 'replace', content: plan.workbookRels });
  if (plan.contentTypes !== null) {
    changes.set(CONTENT_TYPES_PART, { kind: 'replace', content: plan.contentTypes });
  }
  for (const path of plan.paths) {
    if (entries.has(path)) changes.set(path, DROP);
  }
  return changes;
}

/**
 * One entry per output of `request`: the new archive, or null when the output changes
 * nothing (the stored file itself). See the top of this file for the order of the
 * checks. Throws SpreadsheetFileError: every gate and reader error; CORRUPT_FILE with
 * a zip reason from the layout, the view check or the calcChain cut;
 * ROW_ANCHOR_MISMATCH; MALFORMED_SHEET and UNSUPPORTED_ENCODING from the index, the
 * cell cross-check, the merged-range check and the patcher; ROW_NOT_FOUND;
 * PAYLOAD_TOO_LARGE for a patched part beyond its growth cap or outputs beyond
 * MAX_PATCH_OUTPUT_TOTAL_BYTES together.
 */
export function patchUpload(
  file: Uint8Array,
  request: ResolvedPatchRequest,
): (Uint8Array<ArrayBuffer> | null)[] {
  const { read } = request;
  const caps: GridCaps = { rowCap: read.rowCap, colCap: read.colCap };
  const parts = openUpload(file, {
    rowCap: read.rowCap,
    colCap: read.colCap,
    maxBytes: read.maxBytes,
  });

  const layout = readZipLayout(file);
  assertSameViews(file, layout, parts);

  const reading = readSheet(parts, { sheetName: read.sheetName, sheet: read.sheet, caps });
  assertAnchorsMatch(reading.grid, request.anchors);
  assertPatchablePart(reading);

  const { partPath } = reading;
  const source = parts[partPath];
  // The reader converted this part from `parts`; this is not reached.
  if (source === undefined) throw new Error('The converted worksheet part is not a gate part');
  const index = indexWorksheet(source);
  assertSameCells(reading.cellKeys, cellKeysOf(index));
  assertTargetsOutsideMerges(reading.mergeRefs, request.outputs, caps);

  const options: WorksheetPatchOptions = {
    overwriteFormulaColumns: new Set(request.overwriteFormulaColumns),
    maxBytes: patchedPartCap(source.length),
  };
  const entries = entriesByName(layout);
  let calcChain: ReadonlyMap<string, ZipChange> | undefined;
  let totalBytes = 0;
  const outputs: (Uint8Array<ArrayBuffer> | null)[] = [];
  for (const patches of request.outputs) {
    const result = applyCellPatches(index, patches, options);
    if (!result.changed) {
      outputs.push(null);
      continue;
    }
    const changes = new Map<string, ZipChange>();
    if (result.formulasRemoved > 0) {
      calcChain ??= calcChainChanges(file, entries, parts, partPath);
      for (const [name, change] of calcChain) changes.set(name, change);
    }
    changes.set(partPath, { kind: 'replace', content: result.bytes });
    const archive = rewriteZip(file, layout, changes);
    totalBytes += archive.length;
    assertOutputBudget(totalBytes);
    outputs.push(archive);
  }
  return outputs;
}
