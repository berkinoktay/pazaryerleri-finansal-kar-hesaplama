import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

// OOXML stores each sheet's used-range hint in an optional <dimension> element.
// Some exporters (notably Trendyol's "Ürün Komisyon Tarifeleri" export) write a
// SINGLE-CELL dimension (`ref="A1"`) even when the sheet has dozens of columns
// and rows. read-excel-file honours that hint and reads only the first cell,
// silently dropping all data. Stripping the bogus dimension makes read-excel-file
// fall back to the actual <sheetData> rows.

const WORKSHEET_PREFIX = 'xl/worksheets/';

// Matches a single-cell dimension only (`ref="A1"`, no colon). A proper range
// (`ref="A1:AF56"`) is left untouched, so well-formed workbooks pass through
// unchanged and are never re-zipped.
const SINGLE_CELL_DIMENSION = /<dimension\s+ref="[A-Z]+\d+"\s*\/>/g;

/**
 * Removes a bogus single-cell `<dimension>` from every worksheet in an xlsx
 * package so read-excel-file reads the real rows. Returns the original buffer
 * unchanged when the file is not a readable zip, when no worksheet carries a
 * single-cell dimension, or if re-zipping fails — the caller then proceeds with
 * read-excel-file, which surfaces a precise error.
 */
export function stripWorksheetDimensions(file: Buffer): Buffer {
  let entries: ReturnType<typeof unzipSync>;
  try {
    entries = unzipSync(new Uint8Array(file));
  } catch {
    return file;
  }

  let changed = false;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith(WORKSHEET_PREFIX) || !name.endsWith('.xml')) continue;
    const xml = strFromU8(bytes);
    const stripped = xml.replace(SINGLE_CELL_DIMENSION, '');
    if (stripped !== xml) {
      entries[name] = strToU8(stripped);
      changed = true;
    }
  }

  if (!changed) return file;
  try {
    return Buffer.from(zipSync(entries));
  } catch {
    return file;
  }
}
