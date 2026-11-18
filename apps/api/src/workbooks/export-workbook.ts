// The generic workbook export. It knows no page: the adapter loads the record and says
// what each written cell holds; the format says where the cells are. In order:
//   1. load the record with the store's scope;
//   2. find the stored file's format and read its sheet (`resolveStoredWorkbook`);
//   3. plan the patches (`planExport`);
//   4. name the files: two equal names, more files than MAX_PATCH_OUTPUTS, or more
//      patch cells than MAX_PATCH_CELLS, refuse the export before the engine patches
//      anything;
//   5. patch the stored bytes, every planned file in one engine call;
//   6. bundle the download;
//   7. mark the record exported, with the same scope.
// Nothing an export reads surfaces as a 500: every engine call and the format
// selection go through `toStoredFileError` (409, or 503 for a full queue), and a stored
// value the write rule refuses is a 409 too (`rejectStoredFile`).

import type { Platform } from '@pazarsync/db/enums';
import {
  MAX_PATCH_CELLS,
  MAX_PATCH_OUTPUTS,
  patchWorkbook,
  readWorkbookGrid,
  resolveLayout,
  type LayoutSpec,
  type SheetSelector,
} from '@pazarsync/spreadsheet';
import type { WorkbookPage } from '@pazarsync/utils';

import { NotFoundError, WorkbookConflictError } from '../lib/errors';
import type { StoreScope, WorkbookExportAdapter } from './adapter';
import {
  assertDistinctFilenames,
  bundleDownload,
  downloadFilenames,
  type DownloadBundle,
} from './download';
import { planExport, type ExportPlan, type PlanExportInput } from './export-plan';
import type { FilenamePolicy, WorkbookFormat } from './format';
import { FORMAT_SUMMARIES } from './formats/registry';
import { assertScopedWrite } from './scoped-write';
import { selectFormat, type SelectedFormat } from './select-format';
import { rejectStoredFile, toStoredFileError, WorkbookInvariantError } from './workbook-errors';
import {
  resolveWriteColumns,
  UnwritableStoredValueError,
  type ResolvedWriteColumn,
} from './write-columns';

/** `reason` of the stored-file refusal of a plan with more files than one engine call patches. */
export const TOO_MANY_FILES_REASON = 'too-many-files';

/** `reason` of the stored-file refusal of a plan with more cells than one engine call patches. */
export const TOO_MANY_CELLS_REASON = 'too-many-cells';

/** The page and record an export's refusals are logged with. */
export interface ExportContext {
  readonly page: WorkbookPage;
  readonly recordId: string;
}

/**
 * The download names of `plan`, checked before the engine patches anything: two
 * planned files with one name answer EXPORT_FILENAME_COLLISION (a zip would keep one
 * of them), and a plan of more than MAX_PATCH_OUTPUTS files, or of more than
 * MAX_PATCH_CELLS patch cells over all its files, is a stored file one engine call
 * cannot write (logged, 409 STORED_FILE_UNREADABLE). Checked in that order. The
 * stored-workbook audit runs the same checks.
 */
export function plannedDownloadNames(
  format: { readonly filename: FilenamePolicy; readonly defaultName: string },
  source: { readonly name: string; readonly sourceFilename: string | null },
  plan: ExportPlan,
  context: ExportContext,
): string[] {
  const names = downloadFilenames(
    format.filename,
    { name: source.name, sourceFilename: source.sourceFilename, defaultName: format.defaultName },
    plan.files.map((planned) => planned.dayCount),
  );
  assertDistinctFilenames(names);
  if (plan.files.length > MAX_PATCH_OUTPUTS) rejectStoredFile(context, TOO_MANY_FILES_REASON);
  let cells = 0;
  for (const planned of plan.files) cells += planned.patches.length;
  if (cells > MAX_PATCH_CELLS) rejectStoredFile(context, TOO_MANY_CELLS_REASON);
  return names;
}

/** A stored file read for export: its format, its grid and layout, its write columns. */
export interface StoredWorkbook<
  S extends LayoutSpec,
  TRow,
  TWrite extends string,
> extends SelectedFormat<S, TRow, TWrite> {
  readonly resolved: readonly ResolvedWriteColumn<TWrite>[];
}

export interface StoredWorkbookInput<S extends LayoutSpec, TRow, TWrite extends string> {
  readonly page: WorkbookPage;
  readonly formats: readonly WorkbookFormat<S, TRow, TWrite>[];
  readonly file: Buffer;
  readonly sourceFormatId: string | null;
  readonly platform: Platform;
  readonly recordId: string;
}

/** The format the record names, its sheet read strictly and its layout resolved. */
async function readStoredFormat<S extends LayoutSpec, TRow, TWrite extends string>(
  formats: readonly WorkbookFormat<S, TRow, TWrite>[],
  file: Buffer,
  sourceFormatId: string,
): Promise<SelectedFormat<S, TRow, TWrite>> {
  const format = formats.find((candidate) => candidate.id === sourceFormatId);
  if (format === undefined) throw new WorkbookConflictError('STORED_FILE_UNRECOGNIZED');
  const grid = await readWorkbookGrid(file, { sheet: format.sheet });
  const layout = resolveLayout(format.layout, grid);
  if (layout === null) throw new WorkbookConflictError('STORED_FILE_UNRECOGNIZED');
  return { format, grid, layout };
}

/**
 * The stored file's format, grid, layout and write columns, as one block mapped by
 * `toStoredFileError`: a record with a format id reads that format's sheet strictly
 * (an id the page does not know, or a layout that no longer resolves, is
 * STORED_FILE_UNRECOGNIZED); a record without one goes through `selectFormat` over the
 * page's formats for `platform`, whose grid is used as it is (one read). The write
 * columns are resolved here too: their MALFORMED_SHEET is a stored-file refusal.
 */
export async function resolveStoredWorkbook<S extends LayoutSpec, TRow, TWrite extends string>(
  input: StoredWorkbookInput<S, TRow, TWrite>,
): Promise<StoredWorkbook<S, TRow, TWrite>> {
  const { file, sourceFormatId } = input;
  try {
    const selected =
      sourceFormatId === null
        ? await selectFormat(
            file,
            input.formats.filter((format) => format.platform === input.platform),
            {
              read: (bytes, sheet) => readWorkbookGrid(bytes, { sheet }),
              summaries: FORMAT_SUMMARIES,
            },
          )
        : await readStoredFormat(input.formats, file, sourceFormatId);
    return { ...selected, resolved: resolveWriteColumns(selected.format, selected.layout) };
  } catch (err) {
    toStoredFileError(err, { page: input.page, recordId: input.recordId });
  }
}

/**
 * The patch plan of the stored file. A value the record holds that its write column's
 * rule refuses (a list stored before the upload checked its values) is a stored file
 * the export cannot write: logged and answered 409 STORED_FILE_UNREADABLE. Every other
 * error of the plan, a WorkbookInvariantError included, is rethrown untouched.
 */
function planStoredExport<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  input: PlanExportInput<S, TRow, TItem, TWrite>,
  context: ExportContext,
): ExportPlan {
  try {
    return planExport(input);
  } catch (err) {
    if (err instanceof UnwritableStoredValueError) rejectStoredFile(context, err.reason);
    throw err;
  }
}

/**
 * Patches the stored file once per planned file, in one engine call: the caller has
 * bounded the plan to MAX_PATCH_OUTPUTS files.
 */
async function patchPlannedFiles(
  file: Buffer,
  sheet: SheetSelector,
  plan: ExportPlan,
  context: ExportContext,
): Promise<Buffer[]> {
  try {
    return await patchWorkbook(file, {
      sheet,
      anchors: plan.anchors,
      outputs: plan.files.map((planned) => planned.patches),
      overwriteFormulaColumns: plan.overwriteFormulaColumns,
    });
  } catch (err) {
    toStoredFileError(err, context);
  }
}

/**
 * Exports one stored record of a page as a download. `scope` and `platform` come from
 * the verified store record, never from the request path. Throws NotFoundError when the
 * record is not in the scope (or is gone before the `exportedAt` touch), and
 * WorkbookConflictError when it has no stored file or the stored file cannot be
 * exported: among them EXPORT_FILENAME_COLLISION when two planned files share a name,
 * and STORED_FILE_UNREADABLE when the plan holds more than MAX_PATCH_OUTPUTS files, more
 * patch cells than one engine call patches (MAX_PATCH_CELLS), or a stored value its
 * write rule refuses, each before the engine patches anything.
 */
export async function exportWorkbook<S extends LayoutSpec, TRow, TItem, TWrite extends string>(
  adapter: WorkbookExportAdapter<S, TRow, TItem, TWrite>,
  scope: StoreScope,
  id: string,
  platform: Platform,
): Promise<DownloadBundle> {
  const source = await adapter.load(scope, id);
  if (source === null) throw new NotFoundError(adapter.notFoundResource, id);
  if (source.sourceFile === null) throw new WorkbookConflictError('STORED_FILE_MISSING');
  const file = Buffer.from(source.sourceFile);
  const context = { page: adapter.page, recordId: id };

  const stored = await resolveStoredWorkbook({
    page: adapter.page,
    formats: adapter.formats,
    file,
    sourceFormatId: source.sourceFormatId,
    platform,
    recordId: id,
  });
  const plan = planStoredExport({ ...stored, groups: source.groups, adapter }, context);

  // The names, the file count and the cell count before the engine runs: each can refuse
  // the export.
  const names = plannedDownloadNames(stored.format, source, plan, context);

  const outputs = await patchPlannedFiles(file, stored.format.sheet, plan, context);
  const bundle = bundleDownload(
    stored.format.filename,
    names.map((filename, index) => {
      // A missing output must never read as the unchanged stored file.
      const output = outputs[index];
      if (output === undefined) throw new WorkbookInvariantError('A planned file was not patched');
      return { filename, file: output };
    }),
  );

  await assertScopedWrite(adapter.touchExported(scope, id), adapter.notFoundResource, id);
  return bundle;
}
