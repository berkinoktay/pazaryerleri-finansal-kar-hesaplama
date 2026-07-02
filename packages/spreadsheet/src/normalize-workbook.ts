import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

// Normalizes a vendor .xlsx so the (stricter) read-excel-file reader can parse
// it. Two independent problems seen in real Trendyol exports, fixed in one pass:
//
// 1. BOGUS SINGLE-CELL <dimension>. Some exporters (Trendyol's "Ürün Komisyon
//    Tarifeleri") write a single-cell dimension (`ref="A1"`) even on a full
//    sheet. read-excel-file honours it and reads only the first cell, dropping
//    all data. We strip the bogus hint so it falls back to the real rows.
//
// 2. UNCACHED FORMULA CELLS. Some exports (Trendyol's "Plus Komisyon") carry
//    helper columns as formulas WITHOUT a cached value (`<c t="str"><f>=IF(…)</f>
//    </c>`, no `<v>`). read-excel-file then runs `.trim()` on the absent value
//    and throws. A value-less formula genuinely has no readable value (only a
//    spreadsheet app would compute it), so we neutralize such cells to empty.
//
// Additionally, whenever we re-emit the package, fflate writes a plain (non
// ZIP64/streaming) zip — which incidentally fixes the THIRD problem: Trendyol's
// Plus export is a ZIP64/data-descriptor container that read-excel-file's
// bundled unzip rejects outright. So a ZIP64 container alone also triggers a
// re-zip, even when no XML change is needed.

const WORKSHEET_PREFIX = 'xl/worksheets/';

// A single-cell dimension only (`ref="A1"`, no colon). A proper range
// (`ref="A1:AF56"`) is left untouched.
const SINGLE_CELL_DIMENSION = /<dimension\s+ref="[A-Z]+\d+"\s*\/>/g;

// One whole cell — self-closing (`<c …/>`) or open/close (`<c …>…</c>`). The
// non-greedy `[\s\S]*?</c>` stops at the cell's OWN closing tag, so each cell is
// matched INDEPENDENTLY (no cross-cell backtracking that could swallow a
// neighbouring cell's cached value).
const CELL = /<c\b([^>]*?)(\/>|>[\s\S]*?<\/c>)/g;

// A cell is a value-less formula when it carries an <f …> but NO cached <v …>.
// Such cells have no readable value (only a spreadsheet app would compute it),
// so read-excel-file crashes on the absent value; we neutralize them to empty.
// A formula cell that DOES carry a cached <v> is left untouched — its computed
// value is preserved.
function neutralizeSheet(xml: string): string {
  return xml.replace(SINGLE_CELL_DIMENSION, '').replace(CELL, (full, attrs, body) => {
    if (String(body) === '/>') return full; // already empty (self-closing)
    if (!/<f[\s>]/.test(full) || /<v[\s>]/.test(full)) return full; // no formula, or has a value
    const cleaned = String(attrs).replace(/\s+t="[^"]*"/g, '');
    return `<c${cleaned}/>`;
  });
}

// True when the zip carries a ZIP64 local header (version-needed ≥ 45), which
// read-excel-file's bundled unzip rejects. Re-emitting via fflate yields a plain
// zip. Only the first few local headers are checked — enough to classify.
function isZip64Container(file: Buffer): boolean {
  const LOCAL_HEADER = 0x04034b50; // "PK\x03\x04"
  for (let i = 0; i + 6 <= file.length; i += 1) {
    if (file.readUInt32LE(i) !== LOCAL_HEADER) continue;
    if (file.readUInt16LE(i + 4) >= 45) return true;
    i += 3; // skip past this signature
  }
  return false;
}

/**
 * Strips bogus single-cell `<dimension>`s and neutralizes uncached-formula cells
 * across every worksheet, and normalizes a ZIP64 container to a plain zip.
 * Returns the ORIGINAL buffer unchanged when the file is not a readable zip, or
 * when nothing needed normalizing — so well-formed workbooks pass through with no
 * re-zip. On any failure it returns the original, and the caller proceeds with
 * read-excel-file (which surfaces a precise error).
 */
export function normalizeWorkbookForRead(file: Buffer): Buffer {
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
    const normalized = neutralizeSheet(xml);
    if (normalized !== xml) {
      entries[name] = strToU8(normalized);
      changed = true;
    }
  }

  // A ZIP64 container that read-excel-file cannot open must be re-emitted even
  // when no worksheet XML changed.
  if (!changed && !isZip64Container(file)) return file;
  try {
    return Buffer.from(zipSync(entries));
  } catch {
    return file;
  }
}
