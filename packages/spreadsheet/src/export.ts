import writeXlsxFile from 'write-excel-file/node';
import type { Column } from 'write-excel-file/node';
import type { SheetSchema } from './types';
import { renderOutbound } from './coerce';
import { sanitizeCellText } from './sanitize';
import { MAX_CELL_TEXT_LENGTH } from './constants';

// Maps WriteCellType string tags (returned by renderOutbound) to write-excel-file cell type
// constructors. write-excel-file expects constructor references (String, Number, ...) not
// string literals.
const CELL_TYPE_MAP = { String, Number, Boolean, Date } as const;

export async function exportToXlsx<TRow>(
  schema: SheetSchema<TRow>,
  rows: readonly TRow[],
): Promise<Buffer> {
  const columns: Column<TRow>[] = schema.columns.map((col) => ({
    header: { value: col.header, fontWeight: 'bold' as const },
    width: col.width,
    cell: (row: TRow) => {
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
