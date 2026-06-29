import { unzipSync, strFromU8 } from 'fflate';

// NOTE: unzipSync materializes the whole archive in memory. Task 8's byte-cap guard
// must reject oversized Buffers BEFORE calling readSheetDimensions.

/** Converts an Excel column-letter reference (e.g. "AI") to a 1-based column number. */
export function colRefToNumber(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

interface SheetDimension {
  sheetPath: string;
  rows: number;
  cols: number;
}

/**
 * Reads actual row and column counts from each worksheet XML inside an xlsx Buffer.
 *
 * Instead of relying on <dimension ref="A1:F4"> (which many real-world xlsx files write
 * as origin-only "A1", defeating a range parse), we count directly from the XML:
 *   rows — maximum `r` attribute across all <row r="N"> elements
 *   cols — maximum column number derived from cell references in <c r="XY..."> elements
 *
 * This works correctly for both well-formed xlsx and files that emit origin-only <dimension>.
 */
export function readSheetDimensions(file: Buffer): SheetDimension[] {
  const entries = unzipSync(new Uint8Array(file));
  const out: SheetDimension[] = [];

  for (const [path, bytes] of Object.entries(entries)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(path)) continue;

    const xml = strFromU8(bytes);

    // Count rows: scan all <row r="N"> attributes and take the maximum.
    let maxRow = 0;
    const rowRe = /<row r="(\d+)"/g;
    for (const m of xml.matchAll(rowRe)) {
      const g = m[1];
      if (g === undefined) continue;
      const n = Number(g);
      if (n > maxRow) maxRow = n;
    }

    // Count cols: scan all cell references like <c r="AI57">, extract column letters,
    // convert to a 1-based column number, and take the maximum.
    let maxCol = 0;
    const cellRe = /<c r="([A-Z]+)\d+"/g;
    for (const m of xml.matchAll(cellRe)) {
      const g = m[1];
      if (g === undefined) continue;
      const n = colRefToNumber(g);
      if (n > maxCol) maxCol = n;
    }

    out.push({ sheetPath: path, rows: maxRow, cols: maxCol });
  }

  return out;
}
