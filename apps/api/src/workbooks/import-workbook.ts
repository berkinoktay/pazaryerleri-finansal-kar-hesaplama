// The generic workbook import. It knows no page: the adapter and its formats say what
// the file looks like, what to check before writing and how to write. In order:
//   1. refuse early when the store's upload quota is already reached, before the file is
//      parsed; checked again in step 9's transaction;
//   2. pick the format among the page's formats for the store's platform;
//   3. read the rows (keep rule, anchor, mapRow) and resolve the write columns; refuse a
//      file with no column the export requires;
//   4. count the rows a seller already filled in;
//   5. the adapter's own checks (`inspect`), before the costlier rehearsal;
//   6. rehearse the export on the uploaded bytes, so a file the export would refuse is
//      refused now;
//   7. match the anchors to the store's product variants;
//   8. derive the stored name;
//   9. in one transaction: the import lock, the upload quota, `persist`;
//  10. the page's response.
// Steps 2 to 6 map every file problem to a 422 on `file` (toUploadError).

import { prisma } from '@pazarsync/db';
import type { Platform } from '@pazarsync/db/enums';
import {
  patchWorkbook,
  readWorkbookGrid,
  SpreadsheetFileError,
  type LayoutSpec,
} from '@pazarsync/spreadsheet';
import { isPrismaKnownRequestError, syncLog } from '@pazarsync/sync-core';

import { IMPORT_TX_OPTIONS } from '../config/workbook-limits';
import { mapTransactionError } from '../lib/map-transaction-error';
import type { ImportedRow, ParentFields, StoreScope, WorkbookImportAdapter } from './adapter';
import { VALUE_NOT_STORABLE_REASON, VALUE_OUT_OF_RANGE_REASON } from './column-range';
import { FORMAT_SUMMARIES } from './formats/registry';
import { countPrefilled, deriveName, readRows } from './import-rows';
import { buildRehearsal, rehearsalTargets } from './rehearsal';
import { sanitizeUploadFilename } from './sanitize-upload-filename';
import { selectFormat, type SelectedFormat } from './select-format';
import { acquireImportLock, assertUploadQuota } from './upload-quota';
import { toUploadError, WorkbookFileRejection } from './workbook-errors';
import { missingExportRequirement, resolveWriteColumns } from './write-columns';

export interface ImportWorkbookInput<TConfig> {
  readonly organizationId: string;
  readonly storeId: string;
  readonly platform: Platform;
  readonly file: Buffer;
  readonly filename: string;
  readonly createdBy: string | null;
  readonly name: string | undefined;
  readonly config: TConfig;
  readonly now: Date;
}

/**
 * Prisma's code for a value out of range for its column type (Postgres 22003): a number
 * read from the file that its column cannot hold, such as a percent of 100 or more in a
 * numeric(6,4) column (an integer column's range is checked at the read, see
 * column-range.ts). The import checks a decimal only against what the export may write,
 * which can be wider than the column, so the insert is the first to refuse it. The value
 * is the file's, so the upload answers as an unwritable value does (422 MALFORMED_SHEET
 * on `file`) instead of a 500.
 */
const PRISMA_VALUE_OUT_OF_RANGE = 'P2020';

/**
 * A Postgres data exception: SQLSTATE class 22 (a value its column type refuses, such as
 * 22021 for U+0000 in a text column or 22007 for a date the driver cannot format).
 */
const DATA_EXCEPTION_SQLSTATE_RE = /^22[0-9A-Z]{3}$/;

/** The `cause` of a driver adapter error: Postgres' SQLSTATE in `originalCode`. */
interface DriverAdapterCause {
  readonly originalCode: string;
}

/** True when `value` carries a driver adapter `cause` whose `originalCode` is a string. */
function isDriverAdapterFailure(value: unknown): value is { readonly cause: DriverAdapterCause } {
  if (typeof value !== 'object' || value === null || !('cause' in value)) return false;
  const { cause } = value;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'originalCode' in cause &&
    typeof cause.originalCode === 'string'
  );
}

/**
 * The SQLSTATE of a database error raised through Prisma 7 and @prisma/adapter-pg, or
 * null. Measured against Postgres: a typed write whose failure Prisma maps to no code of
 * its own (22021, 22007, 22009) rejects with the adapter's DriverAdapterError itself,
 * which has no `code` and carries `cause: { originalCode, code, kind: 'postgres', ... }`;
 * a failure Prisma maps to a P code (22001 as P2000, 23505 as P2002) rejects with a
 * PrismaClientKnownRequestError holding that same DriverAdapterError under
 * `meta.driverAdapterError`. Both carry the SQLSTATE in `cause.originalCode`.
 */
function postgresSqlState(err: unknown): string | null {
  if (isDriverAdapterFailure(err)) return err.cause.originalCode;
  if (typeof err !== 'object' || err === null || !('meta' in err)) return null;
  const { meta } = err;
  if (typeof meta !== 'object' || meta === null || !('driverAdapterError' in meta)) return null;
  const { driverAdapterError } = meta;
  return isDriverAdapterFailure(driverAdapterError) ? driverAdapterError.cause.originalCode : null;
}

/** What steps 2 to 6 found in the upload. */
interface CheckedUpload<S extends LayoutSpec, TRow, TMeta, TWrite extends string> {
  readonly selected: SelectedFormat<S, TRow, TWrite>;
  readonly rows: readonly ImportedRow<TRow>[];
  readonly skippedRows: number;
  readonly prefilledRows: number;
  readonly meta: TMeta;
}

/** Steps 2 to 6. Throws what `toUploadError` maps; anything else is a bug or the adapter's own error. */
async function checkUpload<
  S extends LayoutSpec,
  TRow,
  TConfig,
  TMeta,
  TResponse,
  TWrite extends string,
>(
  adapter: WorkbookImportAdapter<S, TRow, TConfig, TMeta, TResponse, TWrite>,
  input: ImportWorkbookInput<TConfig>,
  scope: StoreScope,
): Promise<CheckedUpload<S, TRow, TMeta, TWrite>> {
  const candidates = adapter.formats.filter((format) => format.platform === input.platform);
  const selected = await selectFormat(input.file, candidates, {
    read: (file, sheet) => readWorkbookGrid(file, { sheet }),
    summaries: FORMAT_SUMMARIES,
  });

  const read = readRows(selected);
  const resolved = resolveWriteColumns(selected.format, selected.layout);
  if (missingExportRequirement(selected.format, resolved)) {
    // The export could never write this file, so the upload is refused now instead of
    // after the seller made their choices. The warn line stays: it is the signal that a
    // marketplace changed its template.
    syncLog.warn('workbook.import.no-writeback-column', { page: adapter.page });
    throw new WorkbookFileRejection('NO_WRITEBACK_COLUMN');
  }

  const prefilledRows = countPrefilled(selected, read.rows, resolved);
  if (prefilledRows > 0) {
    if (selected.format.prefilled === 'reject') {
      throw new WorkbookFileRejection('PREFILLED_SELECTIONS', { count: prefilledRows });
    }
    syncLog.info('workbook.import.prefilled', { page: adapter.page, count: prefilledRows });
  }

  const meta = await adapter.inspect({
    scope,
    config: input.config,
    now: input.now,
    rows: read.rows,
    firstDataRow: read.firstDataRow,
  });

  const rehearsal = buildRehearsal(selected, rehearsalTargets(adapter.align, read), resolved);
  if (rehearsal.patches.length > 0) {
    // The output is dropped: only what the export path refuses matters here.
    await patchWorkbook(input.file, {
      sheet: selected.format.sheet,
      anchors: rehearsal.anchors,
      outputs: [rehearsal.patches],
      overwriteFormulaColumns: rehearsal.overwriteFormulaColumns,
    });
  }

  return { selected, rows: read.rows, skippedRows: read.skippedRows, prefilledRows, meta };
}

/**
 * The catch of the write transaction: a file rejection `persist` raises on purpose
 * (the in-transaction week re-check), or a unique violation the adapter recognises as
 * one, is a 422 on `file`; a value out of range for its column (P2020), and any other
 * Postgres data exception (SQLSTATE class 22), is the upload's MALFORMED_SHEET on
 * `file` (the transaction rolled back, nothing is stored); everything else goes
 * through `mapTransactionError`, which lets a domain error (the lock's or the quota's
 * conflict) through untouched.
 */
function rethrowPersistError<
  S extends LayoutSpec,
  TRow,
  TConfig,
  TMeta,
  TResponse,
  TWrite extends string,
>(adapter: WorkbookImportAdapter<S, TRow, TConfig, TMeta, TResponse, TWrite>, err: unknown): never {
  const context = { page: adapter.page };
  if (err instanceof WorkbookFileRejection) toUploadError(err, context);
  const code = adapter.rejectionForUniqueViolation(err);
  if (code !== null) toUploadError(new WorkbookFileRejection(code), context);
  if (isPrismaKnownRequestError(err) && err.code === PRISMA_VALUE_OUT_OF_RANGE) {
    // The page and the code only: the driver's message quotes the cell value.
    syncLog.warn('workbook.import.value-out-of-range', {
      page: adapter.page,
      prismaCode: err.code,
    });
    toUploadError(
      new SpreadsheetFileError('MALFORMED_SHEET', 'A file value is out of range for its column', {
        reason: VALUE_OUT_OF_RANGE_REASON,
      }),
      context,
    );
  }
  const sqlState = postgresSqlState(err);
  if (sqlState !== null && DATA_EXCEPTION_SQLSTATE_RE.test(sqlState)) {
    // The page and the SQLSTATE only: the driver's message can quote the cell value.
    syncLog.warn('workbook.import.value-not-storable', { page: adapter.page, sqlState });
    toUploadError(
      new SpreadsheetFileError('MALFORMED_SHEET', 'A file value cannot be stored in its column', {
        reason: VALUE_NOT_STORABLE_REASON,
      }),
      context,
    );
  }
  mapTransactionError(err);
}

/**
 * Imports one uploaded workbook for one store and page. `organizationId`, `storeId`
 * and `platform` come from the verified store record, never from the request path.
 */
export async function importWorkbook<
  S extends LayoutSpec,
  TRow,
  TConfig,
  TMeta,
  TResponse,
  TWrite extends string,
>(
  adapter: WorkbookImportAdapter<S, TRow, TConfig, TMeta, TResponse, TWrite>,
  input: ImportWorkbookInput<TConfig>,
): Promise<TResponse> {
  const scope: StoreScope = { organizationId: input.organizationId, storeId: input.storeId };

  // Step 1: a store at its quota is refused before the costlier parse and rehearsal, with
  // the same scoped count and byte sum the transaction uses. It is not under the import
  // lock, so two concurrent uploads can both pass it: the check inside the transaction
  // (step 9) stays the authority. `mapTransactionError` answers a pool wait as the same
  // retryable 503 and lets the quota's WorkbookConflictError through untouched.
  try {
    const listCount = await adapter.countLists(prisma, scope);
    await assertUploadQuota(prisma, scope, { listCount, incomingBytes: input.file.length });
  } catch (err) {
    mapTransactionError(err);
  }

  let checked: CheckedUpload<S, TRow, TMeta, TWrite>;
  try {
    checked = await checkUpload(adapter, input, scope);
  } catch (err) {
    toUploadError(err, { page: adapter.page });
  }
  const { selected, rows, meta } = checked;

  const distinctAnchors = [...new Set(rows.map((row) => row.anchor))];
  const variants = await prisma.productVariant.findMany({
    where: {
      organizationId: scope.organizationId,
      storeId: scope.storeId,
      barcode: { in: distinctAnchors },
    },
    select: { id: true, barcode: true },
  });
  const variantIdByAnchor = new Map(variants.map((variant) => [variant.barcode, variant.id]));

  const sourceFilename = sanitizeUploadFilename(input.filename);
  const name = deriveName({
    name: input.name,
    sourceFilename,
    fallback: adapter.nameFallback(meta),
    defaultName: selected.format.defaultName,
  });
  const parent: ParentFields = {
    organizationId: scope.organizationId,
    storeId: scope.storeId,
    name,
    sourceFilename,
    sourceFile: new Uint8Array(input.file),
    sourceFormatId: selected.format.id,
    createdBy: input.createdBy,
  };

  let persisted: { parentId: string; itemCount: number };
  try {
    persisted = await prisma.$transaction(async (tx) => {
      await acquireImportLock(tx, scope, adapter.page);
      const listCount = await adapter.countLists(tx, scope);
      await assertUploadQuota(tx, scope, { listCount, incomingBytes: input.file.length });
      return adapter.persist(tx, {
        parent,
        rows,
        variantIdByAnchor,
        config: input.config,
        meta,
      });
    }, IMPORT_TX_OPTIONS);
  } catch (err) {
    rethrowPersistError(adapter, err);
  }

  return adapter.toResponse({
    parentId: persisted.parentId,
    name,
    itemCount: persisted.itemCount,
    rowCount: rows.length,
    distinctCount: distinctAnchors.length,
    matchedRows: rows.filter((row) => variantIdByAnchor.has(row.anchor)).length,
    matchedDistinct: distinctAnchors.filter((anchor) => variantIdByAnchor.has(anchor)).length,
    skippedRows: checked.skippedRows,
    prefilledRows: checked.prefilledRows,
    meta,
  });
}
