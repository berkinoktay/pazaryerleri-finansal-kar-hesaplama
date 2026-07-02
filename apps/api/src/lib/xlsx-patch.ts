// Byte-preserving cell patcher for a stored .xlsx. The seller re-uploads the
// result to Trendyol VERBATIM, so we patch only the specific cells the seller's
// choices touch into the EXACT original file rather than regenerating it — every
// other cell, the styles, even Trendyol's bogus <dimension>, stay byte-for-byte.
//
// Domain-agnostic: the caller decides WHICH cells (by 1-based Excel row + 0-based
// column) get WHICH value; this module does the fflate unzip → per-worksheet
// row-rewrite → zip. Shared by every campaign-tariff export path.

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const WORKSHEET_PREFIX = 'xl/worksheets/';

/** The value written into a patched cell — a numeric `<v>` or an inline string. */
export type XlsxCellValue =
  | { readonly kind: 'number'; readonly value: string }
  | { readonly kind: 'inlineStr'; readonly value: string };

/** Map of 1-based Excel row number → (0-based column index → new cell value). */
export type XlsxRowPatches = ReadonlyMap<number, ReadonlyMap<number, XlsxCellValue>>;

// ─── Column-letter helpers ──────────────────────────────────────────────────

export function columnLetter(index: number): string {
  let letters = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellXml(colIdx: number, rowNum: number, value: XlsxCellValue): string {
  const ref = `${columnLetter(colIdx)}${rowNum}`;
  return value.kind === 'number'
    ? `<c r="${ref}"><v>${value.value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value.value)}</t></is></c>`;
}

// ─── XML row patching ────────────────────────────────────────────────────────

const CELL_RE = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g;
const CELL_REF_RE = /\br="([A-Z]+)\d+"/;
const ROW_OPEN_RE = /<row\b[^>]*>/;
const ROW_RE = /<row\b[^>]*>[\s\S]*?<\/row>/g;
const ROW_NUM_RE = /\br="(\d+)"/;

/** Rewrites one row, replacing the patched cells and keeping the rest verbatim. */
function patchRow(
  rowXml: string,
  rowNum: number,
  cells: ReadonlyMap<number, XlsxCellValue>,
): string {
  const byCol = new Map<number, string>();
  let match: RegExpExecArray | null;
  CELL_RE.lastIndex = 0;
  while ((match = CELL_RE.exec(rowXml)) !== null) {
    const xml = match[0];
    const ref = CELL_REF_RE.exec(xml);
    if (ref?.[1] === undefined) continue;
    byCol.set(columnIndex(ref[1]), xml);
  }

  for (const [colIdx, value] of cells) {
    byCol.set(colIdx, cellXml(colIdx, rowNum, value));
  }

  const openTag = ROW_OPEN_RE.exec(rowXml)?.[0] ?? `<row r="${rowNum}">`;
  const body = [...byCol.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, xml]) => xml)
    .join('');
  return `${openTag}${body}</row>`;
}

/**
 * Patches every listed row's cells across all worksheets, leaving everything else
 * byte-for-byte intact. Returns the source unchanged when there is nothing to patch.
 */
export function patchXlsxCells(source: Buffer, rowPatches: XlsxRowPatches): Buffer {
  if (rowPatches.size === 0) return source;

  const entries = unzipSync(new Uint8Array(source));
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith(WORKSHEET_PREFIX) || !name.endsWith('.xml')) continue;
    const xml = strFromU8(bytes).replace(ROW_RE, (rowXml: string) => {
      const rowNum = ROW_NUM_RE.exec(rowXml);
      if (rowNum?.[1] === undefined) return rowXml;
      const cells = rowPatches.get(Number(rowNum[1]));
      return cells === undefined ? rowXml : patchRow(rowXml, Number(rowNum[1]), cells);
    });
    entries[name] = strToU8(xml);
  }
  return Buffer.from(zipSync(entries));
}
