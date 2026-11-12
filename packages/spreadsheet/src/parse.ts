import { readSheet, parseSheetData } from 'read-excel-file/node';
import type { SheetData, ParseSheetDataError as LibError } from 'read-excel-file/node';
import type {
  CellError,
  CellErrorCode,
  ColumnDef,
  ParsedResult,
  ParsedRow,
  SheetSchema,
} from './types';
import { coerceInbound } from './coerce';
import { resolveHeaders, normalizeHeader } from './header-normalize';
import { SpreadsheetFileError } from './errors';
import {
  DEFAULT_ROW_CAP,
  ABSOLUTE_MAX_ROWS,
  DEFAULT_COL_CAP,
  ABSOLUTE_MAX_COLS,
  DEFAULT_MAX_BYTES,
  ABSOLUTE_MAX_BYTES,
  MAX_ERROR_CAUSE_LENGTH,
  MAX_ERROR_VALUE_LENGTH,
  MAX_QUEUED_PARSES,
} from './constants';
import { prepareUploadForRead } from './guards';

// Property bag for a parsed data row: contains only the key + editable fields
// whose values were coerced by coerceInbound. The generic TRow is erased at runtime;
// a bounded type assertion bridges this internal type to Partial<TRow> at step 10.
type ParsedRowData = Record<string, unknown>;

// Schema entry shape expected by read-excel-file's parseSheetData.
// Matches SchemaEntryForValue<string, ParsedRowData, ParsedRowData, string>
// from the library's internal types; declared locally to avoid importing the
// complex Schema<Object> mapped type.
interface LibSchemaEntry {
  column: string;
  required: boolean;
  // The library's ParseSheetDataCustomType<unknown> is (value: CellValue) => unknown | undefined.
  // A (raw: unknown) => unknown function is assignable to it via contravariance (CellValue ⊆ unknown).
  type: (raw: unknown) => unknown;
}

function mapErrorCode(error: string, reason: string | undefined): CellErrorCode {
  if (error === 'required') return 'REQUIRED_CELL';
  // Built-in library error codes on the `error` field
  if (error === 'not_a_number' || error === 'not_an_integer') return 'INVALID_TYPE';
  // Custom-type errors where coerceInbound threw — message appears in `reason`
  if (reason === 'not_a_number' || reason === 'not_an_integer' || reason === 'syntax')
    return 'INVALID_TYPE';
  return 'INVALID_VALUE';
}

export interface ReadGridOptions {
  readonly sheetName?: string;
  readonly rowCap?: number;
  readonly colCap?: number;
  readonly maxBytes?: number;
}

// One parse at a time per process. The gate builds an xmldom DOM of up to about
// 570 MB (MAX_XML_DOM_WEIGHT) and so does the reader, whose readSheet is async: without
// this queue the gate of one upload can run while another upload's reader still holds
// its DOM, and peak memory grows with the number of uploads in flight. Queued, the
// peak stays at about one parse (~600 MB). At most MAX_QUEUED_PARSES calls are in
// flight (running or waiting); one more is refused at once with ENGINE_BUSY.
let parseQueue: Promise<void> = Promise.resolve();
let parsesInFlight = 0;

/**
 * Runs `task` after every earlier task has settled; a failed task does not stop the
 * queue. Throws SpreadsheetFileError ENGINE_BUSY, without queueing, when
 * MAX_QUEUED_PARSES tasks are already in flight.
 */
function runOneAtATime<T>(task: () => Promise<T>): Promise<T> {
  if (parsesInFlight >= MAX_QUEUED_PARSES) {
    throw new SpreadsheetFileError('ENGINE_BUSY', 'Workbook parse queue is full', {
      cap: MAX_QUEUED_PARSES,
    });
  }
  parsesInFlight += 1;
  const run = parseQueue.then(task).finally(() => {
    parsesInFlight -= 1;
  });
  parseQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Runs the upload security guards, which return the read copy (every <dimension>
 * removed, every cell reference validated and capped, uncached formulas emptied,
 * archive re-zipped; see guards.ts and read-copy.ts), and returns the raw 2D cell
 * grid for the named sheet (falling back to the first sheet). Throws
 * `CORRUPT_FILE` if the workbook cannot be read. This is the shared reader behind
 * `parseXlsx`; consumers parsing a fixed-layout vendor file with DUPLICATE column
 * headers (which header matching cannot disambiguate) use it directly and map
 * columns by position. Calls run one at a time per process (see parseQueue); with
 * MAX_QUEUED_PARSES calls already in flight it rejects at once with `ENGINE_BUSY`.
 */
export async function readWorkbookGrid(
  file: Buffer,
  options: ReadGridOptions = {},
): Promise<SheetData> {
  const rowCap = Math.min(options.rowCap ?? DEFAULT_ROW_CAP, ABSOLUTE_MAX_ROWS);
  const colCap = Math.min(options.colCap ?? DEFAULT_COL_CAP, ABSOLUTE_MAX_COLS);
  const maxBytes = Math.min(options.maxBytes ?? DEFAULT_MAX_BYTES, ABSOLUTE_MAX_BYTES);
  return runOneAtATime(async () => {
    // Security guards (size, magic, streaming zip-bomb, structure, part budgets,
    // content scan, row/col/cell caps) and the read copy in one step. The reader
    // parses only this copy, never the raw upload: a forged or vendor-mangled
    // <dimension> must not size the grid, and the caps hold for exactly the cells the
    // reader will find.
    const readCopy = prepareUploadForRead(file, { rowCap, colCap, maxBytes });
    try {
      return options.sheetName !== undefined
        ? await readSheet(readCopy, options.sheetName)
        : await readSheet(readCopy);
    } catch {
      try {
        return await readSheet(readCopy);
      } catch (e) {
        throw new SpreadsheetFileError('CORRUPT_FILE', 'Cannot read workbook', {
          cause: String(e).slice(0, MAX_ERROR_CAUSE_LENGTH),
        });
      }
    }
  });
}

export async function parseXlsx<TRow>(
  schema: SheetSchema<TRow>,
  file: Buffer,
): Promise<ParsedResult<TRow>> {
  // Step 1: guards + read raw 2D grid from the read copy, via the shared reader.
  const rowCap = Math.min(schema.options.rowCap ?? DEFAULT_ROW_CAP, ABSOLUTE_MAX_ROWS);
  const grid = await readWorkbookGrid(file, {
    sheetName: schema.options.sheetName,
    rowCap: schema.options.rowCap,
    colCap: schema.options.colCap,
  });

  // Step 2: Skip leading empty/banner rows up to headerLookahead to locate the header row.
  const lookahead = schema.options.headerLookahead ?? 0;
  let headerIdx = 0;
  while (headerIdx <= lookahead && headerIdx < grid.length) {
    const row = grid[headerIdx];
    // noUncheckedIndexedAccess: row can be undefined even with the length guard (TypeScript is conservative)
    if (row === undefined || !row.every((c) => c === null || c === undefined || c === '')) break;
    headerIdx += 1;
  }
  if (headerIdx >= grid.length) {
    throw new SpreadsheetFileError('SHEET_NOT_FOUND', 'No header row found in sheet');
  }
  // 1-based Excel row that contains column headers (used later for excelRow calculations)
  const headerRowNumber = headerIdx + 1;

  // Step 3: Normalize header cells and resolve column presence against the schema.
  const rawHeaderRow = grid[headerIdx] ?? [];
  const { canonicalHeaderRow, missingExpectedHeaders, presentKeys } = resolveHeaders(
    schema,
    rawHeaderRow,
  );

  // Step 4: Post-read row cap check (defense in depth: the read copy's per-cell row cap is
  // the first line and counts the header row; this one counts data rows below the header).
  const dataRowCount = grid.length - (headerIdx + 1);
  if (dataRowCount > rowCap) {
    throw new SpreadsheetFileError(
      'ROW_CAP_EXCEEDED',
      `Row count ${dataRowCount} exceeds cap ${rowCap}`,
      {
        rowCap,
        received: dataRowCount,
      },
    );
  }

  // Step 5: Build the read-excel-file schema.
  //   Only key + editable columns that are present in the file are ingested.
  //   readonly and computed columns are omitted — their values are ignored on parse.
  const ingestCols = schema.columns.filter(
    (c) => (c.role === 'key' || c.role === 'editable') && presentKeys.has(c.key),
  );

  // Generic helper to build a LibSchemaEntry per column, preserving K so that
  // `col.validate(value as TRow[K])` is expressible without widening K to keyof TRow & string.
  function buildEntry<K extends keyof TRow & string>(col: ColumnDef<TRow, K>): LibSchemaEntry {
    return {
      column: normalizeHeader(col.header),
      required: col.required ?? false,
      // Empty-cell short-circuit (spike B2): skip coerceInbound for null/undefined/'' cells.
      // The library handles required validation separately — required + empty still errors.
      type: (raw: unknown): unknown => {
        if (raw === null || raw === undefined || raw === '') return null;
        const value = coerceInbound(col, raw);
        if (col.validate !== undefined && value !== null && value !== undefined) {
          // Generic-deserialization boundary: coerceInbound has produced the column's
          // declared TRow[K] runtime type (enforced by defineColumn), but TS sees `unknown`.
          // Same justified boundary as `obj as Partial<TRow>` elsewhere in this file.
          const result = col.validate(value as TRow[K]);
          if (result !== undefined) throw new Error(result.detail);
        }
        return value;
      },
    };
  }

  // Build as a plain Record; the value shape satisfies SchemaEntryForValue structurally
  // when passed to parseSheetData (library resolves via structural typing at call site).
  const libSchema: Record<string, LibSchemaEntry> = {};
  for (const col of ingestCols) {
    libSchema[col.key] = buildEntry(col);
  }

  // Step 6: Replace the raw header row with canonical names so parseSheetData matches columns.
  //   string[] is structurally assignable to (CellValue | null)[] — string ⊆ CellValue.
  const dataRows = grid.slice(headerIdx + 1);
  const normalizedGrid: SheetData = [canonicalHeaderRow, ...dataRows];

  // Step 7: Run the schema-driven parser.
  //   ParseSheetDataResult is a discriminated union:
  //     success → { objects: ParsedRowData[]; errors: undefined }
  //     failure → { objects: undefined; errors: LibError[] }
  //   Nullish coalescing gives safe, non-asserting access to both sides.
  const result = parseSheetData<ParsedRowData>(normalizedGrid, libSchema);
  const libErrors: LibError[] = result.errors ?? [];
  const libObjects: ParsedRowData[] = result.objects ?? [];

  // Step 8: rowKeys extractor — reads key-role cell values from the raw grid for error context.
  //   This is independent of whole-row drops: an erroring row may not appear in libObjects.
  const keyCols = schema.columns.filter((c) => c.role === 'key' && presentKeys.has(c.key));
  const colIndexByCanonical = new Map<string, number>(canonicalHeaderRow.map((h, i) => [h, i]));
  const rowKeysFor = (dataRow: number): Record<string, string> => {
    const gridRow = grid[headerIdx + dataRow];
    if (gridRow === undefined) return {};
    const out: Record<string, string> = {};
    for (const col of keyCols) {
      const canon = normalizeHeader(col.header);
      const idx = colIndexByCanonical.get(canon);
      if (idx !== undefined) {
        const val = gridRow[idx]; // (CellValue | null) | undefined — noUncheckedIndexedAccess
        if (val !== null && val !== undefined) {
          out[col.key] = String(val);
        }
      }
    }
    return out;
  };

  // Step 9: Map library errors to domain CellError.
  const canonicalToCol = new Map(
    schema.columns.map((c) => [normalizeHeader(c.header), c] as const),
  );
  const cellErrors: CellError[] = libErrors.map((e) => {
    const col = canonicalToCol.get(normalizeHeader(e.column));
    return {
      dataRow: e.row,
      excelRow: e.row + headerRowNumber,
      columnKey: col?.key ?? e.column,
      columnHeader: e.column,
      code: mapErrorCode(e.error, e.reason),
      // e.value is CellValue | null | undefined across the error union; normalise to undefined.
      // String values are truncated to MAX_ERROR_VALUE_LENGTH to prevent unbounded error payloads.
      value:
        typeof e.value === 'string'
          ? e.value.slice(0, MAX_ERROR_VALUE_LENGTH)
          : (e.value ?? undefined),
      rowKeys: rowKeysFor(e.row),
    };
  });

  // Step 10: Map parsed objects to domain ParsedRow.
  //   obj is Record<string, unknown> from parseSheetData; it contains exactly the key + editable
  //   fields that coerceInbound populated. TypeScript cannot express this statically (TRow is
  //   generic, schema is dynamic), so a single bounded type assertion bridges the gap here.
  const parsedRows: Array<ParsedRow<TRow>> = libObjects.map((obj, i) => ({
    dataRow: i + 1,
    excelRow: i + 1 + headerRowNumber,
    data: obj as Partial<TRow>,
  }));

  return {
    totalRows: dataRowCount,
    validRows: parsedRows.length,
    rows: parsedRows,
    errors: cellErrors,
    missingExpectedHeaders,
  };
}
