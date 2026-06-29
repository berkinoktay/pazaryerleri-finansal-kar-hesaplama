import { Decimal } from 'decimal.js';
import writeXlsxFile from 'write-excel-file/node';
import type { Column } from 'write-excel-file/node';
import type { SheetSchema } from './types';
import { renderOutbound } from './coerce';
import { sanitizeCellText } from './sanitize';
import { MAX_CELL_TEXT_LENGTH } from './constants';

// Maps WriteCellType string tags (returned by renderOutbound / renderFormatted) to write-excel-file
// cell type constructors. write-excel-file expects constructor references (String, Number, ...)
// not string literals.
const CELL_TYPE_MAP = { String, Number, Boolean, Date } as const;

// Intermediate typed cell representation returned by renderFormatted.
// Using a discriminated union on `type` lets TypeScript narrow `value` without type assertions:
// in the String branch, value is `string | null`; in other branches, value is a non-null primitive.
type WriteCell =
  | { readonly value: string | null; readonly type: 'String'; readonly format?: string }
  | { readonly value: number; readonly type: 'Number'; readonly format?: string }
  | { readonly value: boolean; readonly type: 'Boolean'; readonly format?: string }
  | { readonly value: Date; readonly type: 'Date'; readonly format?: string };

// Converts a col.format() return value to a WriteCell.
// Strings are sanitized for formula injection and truncated to the Excel cell limit here,
// so callers do not need to sanitize again.
function renderFormatted(
  value: string | number | boolean | Date | Decimal | null,
  excelFormat?: string,
): WriteCell {
  if (value === null) return { value: null, type: 'String' };
  if (value instanceof Decimal)
    return { value: value.toNumber(), type: 'Number', format: excelFormat };
  if (value instanceof Date) return { value, type: 'Date', format: excelFormat };
  if (typeof value === 'number') return { value, type: 'Number', format: excelFormat };
  if (typeof value === 'boolean') return { value, type: 'Boolean' };
  // string: sanitize formula injection and truncate to Excel's cell limit
  return { value: sanitizeCellText(value.slice(0, MAX_CELL_TEXT_LENGTH)), type: 'String' };
}

export async function exportToXlsx<TRow>(
  schema: SheetSchema<TRow>,
  rows: readonly TRow[],
): Promise<Buffer> {
  const columns: Column<TRow>[] = schema.columns.map((col) => ({
    header: { value: col.header, fontWeight: 'bold' as const },
    width: col.width,
    cell: (row: TRow) => {
      // col.format path: call the schema-defined serializer and convert to a WriteCell.
      // col.format(row[col.key]) is type-safe with no cast: row[col.key] is TRow[K] and
      // col.format expects TRow[K], so TypeScript checks this without an assertion.
      if (col.format !== undefined) {
        const cell = renderFormatted(col.format(row[col.key]), col.excelFormat);

        if (cell.type === 'String') {
          // cell.value is `string | null`; null means empty cell.
          if (cell.value === null) return null;
          // String value already sanitized and truncated by renderFormatted.
          return { value: cell.value, type: String };
        }

        // Number | Boolean | Date — value is always non-null from renderFormatted.
        return {
          value: cell.value,
          type: CELL_TYPE_MAP[cell.type],
          format: cell.format,
        };
      }

      // Default path: use renderOutbound (type-driven serialization, no col.format).
      const rendered = renderOutbound(col, row[col.key]);

      // Null/undefined value -> empty cell (never write 0 for missing decimals)
      if (rendered.value === null) {
        return null;
      }

      // String cells: sanitize for formula injection and truncate to Excel's cell limit
      if (rendered.type === 'String') {
        const text = String(rendered.value);
        const truncated = text.slice(0, MAX_CELL_TEXT_LENGTH);
        return { value: sanitizeCellText(truncated), type: String };
      }

      // Numeric, boolean, and date cells: pass the value and constructor type.
      // col.excelFormat (e.g. '#,##0.00') controls the cell display format.
      return {
        value: rendered.value,
        type: CELL_TYPE_MAP[rendered.type],
        format: col.excelFormat,
      };
    },
  }));

  return writeXlsxFile([...rows], {
    columns,
    sheet: schema.options.sheetName,
    stickyRowsCount: schema.options.freezeHeader === false ? 0 : 1,
  }).toBuffer();
}
