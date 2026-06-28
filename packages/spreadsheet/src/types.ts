import type { Decimal } from 'decimal.js';

export type ColumnRole = 'key' | 'readonly' | 'editable' | 'computed';

export type CellType =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'percent'
  | 'boolean'
  | 'date'
  | 'string[]'
  | 'custom';

export type PercentScale = 'whole' | 'fraction';

export interface CellValidationError {
  readonly code: 'INVALID_VALUE';
  readonly detail: string;
}

export interface ColumnDef<TRow, K extends keyof TRow & string = keyof TRow & string> {
  readonly key: K;
  readonly header: string;
  readonly aliases?: readonly string[];
  readonly type: CellType;
  readonly percentScale?: PercentScale; // required when type === 'percent' (defineColumn validates this)
  readonly columnRequired?: boolean; // "column must be present in the file" (structural)
  readonly required?: boolean; // "cell must not be empty" (row-level)
  readonly role: ColumnRole;
  readonly parse?: (raw: unknown) => TRow[K];
  readonly format?: (value: TRow[K]) => string | number | boolean | Date | Decimal | null;
  readonly excelFormat?: string;
  readonly validate?: (value: TRow[K]) => CellValidationError | void;
  readonly width?: number;
  readonly stringifyLossless?: boolean; // defaults to true for key columns (coerce applies)
}

export interface SheetOptions {
  readonly sheetName: string;
  readonly rowCap?: number;
  readonly colCap?: number;
  readonly freezeHeader?: boolean;
  readonly headerLookahead?: number; // max number of banner/empty rows to skip before the header
}

export interface SheetSchema<TRow> {
  readonly options: SheetOptions;
  readonly columns: ReadonlyArray<ColumnDef<TRow>>;
}

export type CellErrorCode = 'REQUIRED_CELL' | 'INVALID_TYPE' | 'INVALID_VALUE';

export interface CellError {
  readonly dataRow: number; // 1-based data row (excluding the header)
  readonly excelRow: number; // actual spreadsheet row number
  readonly columnKey: string;
  readonly columnHeader: string;
  readonly code: CellErrorCode;
  readonly detail?: string;
  readonly value?: unknown;
  readonly rowKeys?: Readonly<Record<string, string>>;
}

export interface ParsedRow<TRow> {
  readonly dataRow: number;
  readonly excelRow: number;
  readonly data: Partial<TRow>;
}

export interface ParsedResult<TRow> {
  readonly totalRows: number;
  readonly validRows: number;
  readonly rows: ReadonlyArray<ParsedRow<TRow>>;
  readonly errors: ReadonlyArray<CellError>;
  readonly missingExpectedHeaders: ReadonlyArray<string>;
}
