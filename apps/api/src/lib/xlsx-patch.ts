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

// Real Trendyol worksheets declare a namespace prefix on the root (`<x:worksheet>`),
// so every emitted cell must mirror that same prefix — an unprefixed `<c>` inside an
// `<x:...>` document references an undeclared namespace (broken XML). `prefix` is the
// row's own prefix including the trailing colon (e.g. `"x:"`) or `""` for none.
function cellXml(prefix: string, colIdx: number, rowNum: number, value: XlsxCellValue): string {
  const ref = `${columnLetter(colIdx)}${rowNum}`;
  return value.kind === 'number'
    ? `<${prefix}c r="${ref}"><${prefix}v>${value.value}</${prefix}v></${prefix}c>`
    : `<${prefix}c r="${ref}" t="inlineStr"><${prefix}is><${prefix}t>${xmlEscape(value.value)}</${prefix}t></${prefix}is></${prefix}c>`;
}

// ─── XML row patching ────────────────────────────────────────────────────────

// Tag regexes tolerate an optional `\w+:` namespace prefix so prefixed vendor files
// (`<x:row>`, `<x:c>`) match too. The `r="..."` attribute is prefix-independent, so
// CELL_REF_RE / ROW_NUM_RE stay as-is. ROW_PREFIX_RE captures the row's own prefix
// (with the colon) so patched cells can be emitted under the same namespace.
const CELL_RE = /<(?:\w+:)?c\b[^>]*\/>|<(?:\w+:)?c\b[^>]*>[\s\S]*?<\/(?:\w+:)?c>/g;
const CELL_REF_RE = /\br="([A-Z]+)\d+"/;
const ROW_OPEN_RE = /<(?:\w+:)?row\b[^>]*>/;
const ROW_RE = /<(?:\w+:)?row\b[^>]*>[\s\S]*?<\/(?:\w+:)?row>/g;
const ROW_NUM_RE = /\br="(\d+)"/;
const ROW_PREFIX_RE = /<(\w+:)?row\b/;

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

  // Patched cells inherit the row's own namespace prefix so they stay valid XML.
  const prefix = ROW_PREFIX_RE.exec(rowXml)?.[1] ?? '';
  for (const [colIdx, value] of cells) {
    byCol.set(colIdx, cellXml(prefix, colIdx, rowNum, value));
  }

  const openTag = ROW_OPEN_RE.exec(rowXml)?.[0] ?? `<${prefix}row r="${rowNum}">`;
  const body = [...byCol.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, xml]) => xml)
    .join('');
  return `${openTag}${body}</${prefix}row>`;
}

/**
 * Patches every listed row's cells across all worksheets, leaving everything else
 * byte-for-byte intact. Returns the source unchanged when there is nothing to patch.
 *
 * Fails LOUD when a requested row is never matched in ANY worksheet: a full or partial
 * miss (e.g. a tag-regex mismatch that quietly skipped every `<row>`) would otherwise
 * return unpatched bytes and silently drop the seller's choices — the "all-Hayır export"
 * class of bug. Callers build `rowPatches` only for rows that exist in the source grid,
 * so a missed row always means the patch machinery failed, never a bogus request.
 */
export function patchXlsxCells(source: Buffer, rowPatches: XlsxRowPatches): Buffer {
  if (rowPatches.size === 0) return source;

  // Row numbers actually matched + rewritten, accumulated across ALL worksheets (a
  // target row may live in only one sheet), so the shortfall check below is global.
  const matchedRows = new Set<number>();
  const entries = unzipSync(new Uint8Array(source));
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith(WORKSHEET_PREFIX) || !name.endsWith('.xml')) continue;
    const xml = strFromU8(bytes).replace(ROW_RE, (rowXml: string) => {
      const rowNum = ROW_NUM_RE.exec(rowXml);
      if (rowNum?.[1] === undefined) return rowXml;
      const parsed = Number(rowNum[1]);
      const cells = rowPatches.get(parsed);
      if (cells === undefined) return rowXml;
      matchedRows.add(parsed);
      return patchRow(rowXml, parsed, cells);
    });
    entries[name] = strToU8(xml);
  }

  const missing = [...rowPatches.keys()].filter((row) => !matchedRows.has(row));
  if (missing.length > 0) {
    throw new Error(
      `xlsx patch matched ${matchedRows.size} of ${rowPatches.size} target rows; ` +
        `unmatched rows: ${missing.join(', ')}`,
    );
  }

  return Buffer.from(zipSync(entries));
}
