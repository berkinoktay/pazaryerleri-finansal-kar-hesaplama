// The generic workbook export. It knows no page: the adapter loads the record and says
// what each written cell holds; the format says where the cells are. In order:
//   1. load the record with the store's scope;
//   2. find the stored file's format and read its sheet (`resolveStoredWorkbook`);
//   3. plan the patches (`planExport`);
//   4. patch the stored bytes, at most MAX_PATCH_OUTPUTS files per engine call;
//   5. name the files and bundle the download;
//   6. mark the record exported, with the same scope.
// Nothing an export reads surfaces as a 500: every engine call and the format
// selection go through `toStoredFileError` (409, or 503 for a full queue).

import type { Platform } from '@pazarsync/db/enums';
import {
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
import { bundleDownload, downloadFilenames, type DownloadBundle } from './download';
import { planExport, type ExportPlan } from './export-plan';
import type { WorkbookFormat } from './format';
import { FORMAT_SUMMARIES } from './formats/registry';
import { assertScopedWrite } from './scoped-write';
import { selectFormat, type SelectedFormat } from './select-format';
import { toStoredFileError, WorkbookInvariantError } from './workbook-errors';
import { resolveWriteColumns, type ResolvedWriteColumn } from './write-columns';

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

/** Patches the stored file once per planned file, at most MAX_PATCH_OUTPUTS files per call. */
async function patchPlannedFiles(
  file: Buffer,
  sheet: SheetSelector,
  plan: ExportPlan,
  context: { readonly page: WorkbookPage; readonly recordId: string },
): Promise<Buffer[]> {
  const outputs: Buffer[] = [];
  for (let start = 0; start < plan.files.length; start += MAX_PATCH_OUTPUTS) {
    const chunk = plan.files.slice(start, start + MAX_PATCH_OUTPUTS);
    try {
      const patched = await patchWorkbook(file, {
        sheet,
        anchors: plan.anchors,
        outputs: chunk.map((planned) => planned.patches),
        overwriteFormulaColumns: plan.overwriteFormulaColumns,
      });
      outputs.push(...patched);
    } catch (err) {
      toStoredFileError(err, context);
    }
  }
  return outputs;
}

/**
 * Exports one stored record of a page as a download. `scope` and `platform` come from
 * the verified store record, never from the request path. Throws NotFoundError when the
 * record is not in the scope (or is gone before the `exportedAt` touch), and
 * WorkbookConflictError when it has no stored file or the stored file cannot be
 * exported.
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
  const plan = planExport({ ...stored, groups: source.groups, adapter });
  const outputs = await patchPlannedFiles(file, stored.format.sheet, plan, context);

  const names = downloadFilenames(
    stored.format.filename,
    {
      name: source.name,
      sourceFilename: source.sourceFilename,
      defaultName: stored.format.defaultName,
    },
    plan.files.map((planned) => planned.dayCount),
  );
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
