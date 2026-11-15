import { MAX_PATCH_OUTPUT_TOTAL_BYTES } from '../constants';
import { SpreadsheetFileError } from '../errors';
import { openUploadWithLayout, type UploadParts } from '../guards';
import type { GridCaps } from '../part-checks';
import { readSheet, type SheetReading } from '../read-grid';
import { CONTENT_TYPES_PART, WORKBOOK_RELS_PART } from '../workbook-parts';
import { assertAnchorsMatch } from './anchors';
import { planCalcChainRemoval } from './calc-chain';
import { assertTargetsOutsideFormulaRanges, assertTargetsOutsideMerges } from './merged-ranges';
import { assertPatchTargets, type ResolvedPatchRequest } from './patch-request';
import { applyCellPatches, patchedPartCap, type WorksheetPatchOptions } from './patch-worksheet';
import {
  entryContent,
  rewriteZip,
  type DeflatedContent,
  type ZipChange,
  type ZipEntry,
} from './raw-zip';
import { MALFORMED_SHEET_REASONS, PATCH_LIMIT_REASONS, ZIP_REJECT_REASONS } from './reasons';
import { foldAsciiCase, metaEntryName } from './shared';
import { cellKeysOf, indexWorksheet } from './sheet-index';
import { entriesByName } from './zip-views';

// The export patch path, sync and in-process: one stored upload in, one archive per
// output out. Cheap checks run before the DOM, and no archive is returned before
// every check has passed:
//   0. every patch target lies inside the read caps (resolvePatchRequest checked it
//      on the main thread; a request that did not come through there is checked
//      here, because the merged-range check below looks only inside the caps);
//   1. the gate (openUploadWithLayout): the same checks a grid read runs;
//   2. among them, the zip layout (readZipLayout), then the view check: every part the
//      gate returned equals the directory's entry of that name. Neither builds a DOM,
//      so a stored file the layout refuses costs no full parse, and the gate hands
//      back the layout it walked, so a job walks it once;
//   3. the reader (readSheet) on the gate's parts; its grid never leaves the job, so
//      the grid text cap does not apply;
//   4. the caller's anchors, on the reader's grid;
//   5. the converted part must not be one the rewrite may also replace;
//   6. the worksheet index on the same bytes, which must list the cells the reader
//      placed, in the same order (the index assumes the reader's strict parse passed);
//   7. no target inside a merged range (its top-left corner excepted), nor anywhere in
//      the range of an array or data table formula (only its top-left cell holds the
//      `f`, so the patcher alone would write the others);
//   8. each output's patches, applied to the index;
//   9. a changed output is the archive with the converted part replaced and, when a
//      formula was overwritten, the calcChain cut. rewriteZip refuses an output whose
//      directory region would hold a local-header signature (the gate's stream would
//      read it); the bytes of all outputs together are capped.
// The patched part is built from the bytes the reader parsed, never from the
// directory's copy.
//
// An output is not bound by the import caps (read.maxBytes, the DOM weight): it goes
// to the marketplace, not back through our import gate, and those caps bound what our
// own parse may cost. Its size is bounded by the patch growth cap of its part
// (patchedPartCap) and by MAX_PATCH_OUTPUT_TOTAL_BYTES for the whole job.

// Every relationships part ends with this, the package's root relationships included;
// a calcChain path never drops one.
const RELATIONSHIPS_PART_SUFFIX = '.rels';
const DROP: ZipChange = { kind: 'drop' };

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
 * CORRUPT_FILE `package-part` for a calcChain path or cut part name that names a part
 * every output needs, compared folding ASCII case (the way OPC compares part names):
 * the converted part, any reader part, the content types, or any relationships part.
 * A Target is free text; dropping such a path would lose that part, or put a drop and
 * a replace on the same entry.
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
      { reason: ZIP_REJECT_REASONS.PACKAGE_PART, entry: metaEntryName(path) },
    );
  }
}

/**
 * The changes that cut the calcChain: the workbook rels and the content types without
 * it, and a drop of each entry whose name, folding ASCII case, is a part whose
 * calcChain Override was cut. A path the rels name with no such Override keeps its
 * entry: its relationship is cut, so no opener loads it as a calcChain, and the part
 * may be one other relationships use (a crafted Target can name any part). Empty when
 * the workbook rels name no calcChain part. The content types come from the
 * directory's view (the gate keeps no copy of that part), bounded by entryContent,
 * read only when the rels name a calcChain, and only lexed.
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
  const plan = planCalcChainRemoval(workbookRels, () => entryContent(file, contentTypes));
  if (plan === null) return changes;
  assertDroppable([...plan.paths, ...plan.cutParts], parts, partPath);
  changes.set(WORKBOOK_RELS_PART, { kind: 'replace', content: plan.workbookRels });
  if (plan.contentTypes !== null) {
    changes.set(CONTENT_TYPES_PART, { kind: 'replace', content: plan.contentTypes });
  }
  if (plan.cutParts.length === 0) return changes;
  const cutParts = new Set(plan.cutParts.map(foldAsciiCase));
  for (const name of entries.keys()) {
    if (cutParts.has(foldAsciiCase(name))) changes.set(name, DROP);
  }
  return changes;
}

/**
 * One entry per output of `request`: the new archive, or null when the output changes
 * nothing (the stored file itself). See the top of this file for the order of the
 * checks. Throws Error('Invalid patch request: ...') first for a patch target outside
 * the read caps. Throws SpreadsheetFileError: every gate and reader error;
 * CORRUPT_FILE with a zip reason from the layout, the view check, the calcChain cut or
 * the output's own directory check;
 * ROW_ANCHOR_MISMATCH; MALFORMED_SHEET and UNSUPPORTED_ENCODING from the index, the
 * cell cross-check, the merged-range and formula-range checks and the patcher;
 * ROW_NOT_FOUND;
 * PAYLOAD_TOO_LARGE for a patched part beyond its growth cap, or outputs beyond
 * MAX_PATCH_OUTPUT_TOTAL_BYTES together. An output may be larger than the import caps
 * allow (see the top of this file).
 */
export function patchUpload(
  file: Uint8Array,
  request: ResolvedPatchRequest,
): (Uint8Array<ArrayBuffer> | null)[] {
  const { read } = request;
  assertPatchTargets(request.outputs, read);
  const caps: GridCaps = { rowCap: read.rowCap, colCap: read.colCap };
  const { parts, layout } = openUploadWithLayout(file, {
    rowCap: read.rowCap,
    colCap: read.colCap,
    maxBytes: read.maxBytes,
  });

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
  assertTargetsOutsideFormulaRanges(reading.formulaRangeRefs, request.outputs, caps);

  const options: WorksheetPatchOptions = {
    overwriteFormulaColumns: new Set(request.overwriteFormulaColumns),
    maxBytes: patchedPartCap(source.length),
  };
  const entries = entriesByName(layout);
  let calcChain: ReadonlyMap<string, ZipChange> | undefined;
  // The calcChain replacements are the same content objects in every output, so each
  // is deflated and checksummed once per job.
  const deflated = new Map<Uint8Array, DeflatedContent>();
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
    const archive = rewriteZip(file, layout, changes, deflated);
    // The patched part is this output's own: keeping it would hold every output's
    // part in memory until the job ends.
    deflated.delete(result.bytes);
    totalBytes += archive.length;
    assertOutputBudget(totalBytes);
    outputs.push(archive);
  }
  return outputs;
}
