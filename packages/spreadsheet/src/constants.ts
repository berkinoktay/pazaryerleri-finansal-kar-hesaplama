// Absolute ceilings that clamp consumer overrides; the engine owns the limits.
export const DEFAULT_ROW_CAP = 5_000;
export const ABSOLUTE_MAX_ROWS = 20_000;
export const DEFAULT_COL_CAP = 64;
export const ABSOLUTE_MAX_COLS = 256;
export const MAX_TOTAL_CELLS = 1_000_000;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const ABSOLUTE_MAX_BYTES = 25 * 1024 * 1024;
// Total decompressed bytes of every entry in the upload, counted while streaming.
// An upload is at most 10 MiB and real files inflate to about 0.2 MB; images are
// already compressed, so they do not grow when inflated. The gate also checks every
// declared entry size against the real one, and the export patch path inflates an
// entry only up to its declared size and refuses one that declares more than this cap
// (entryContent in patch/raw-zip.ts), so this cap also bounds what an export inflates.
export const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 64;
// Raw bytes of xl/_rels/workbook.xml.rels, and of the root relationships part
// _rels/.rels, which the stream keeps apart from MAX_XML_TOTAL_BYTES. A real one lists
// a handful of parts in a few KB (each relationship is about 150 B, and an upload holds
// at most MAX_ZIP_ENTRIES entries), so the gate refuses a larger one
// (PAYLOAD_TOO_LARGE): the root relationships part while streaming it, the workbook
// rels before it builds a DOM from them (selectReaderParts). The gate runs inside the
// parse worker, on every read and every patch alike.
export const MAX_WORKBOOK_RELS_BYTES = 64 * 1024;
// Total decompressed bytes of the entries named .xml or .xml.rels (the only entries
// whose content the gate keeps), counted while streaming. Nothing is re-serialized,
// so this also bounds the XML the reader parses. Real exports are about 0.2 MB and a
// full 5 000 x 64 sheet of short values about 20 MB; 32 MiB keeps headroom while
// bounding the text the gate holds.
export const MAX_XML_TOTAL_BYTES = 32 * 1024 * 1024;
// The ceilings below apply to the raw bytes of the parts the grid reader opens (the
// workbook rels, the workbook and the styles, shared strings and worksheet parts the
// rels name), before any XML is parsed. Other entries are never parsed.
// Longest element name (prefix included, in bytes). The longest name in real exports
// is 19; the cap first bounded the per-element cost of the old reader's quadratic
// tag-name regex, and still keeps every name the gate and the reader handle short.
export const MAX_XML_NAME_LENGTH = 32;
// DOM weight: what the xmldom DOM of the reader parts will cost in heap, estimated on
// raw bytes before anything is parsed. One unit is about 100 B. Measured with
// xmldom 0.9.12 (heap after GC, 200 000 nodes each):
//   - an element (every '<' not followed by '/', '!' or '?'): 803 B, about 1 000 B
//     when it has children;
//   - an attribute (every '=' byte, text '=' included): 344 B for the first on an
//     element, 184 B for the second;
//   - a text node (every '>' followed by a byte other than '<', which counts each run
//     of text or whitespace between tags at least once): 304 B; a comment, CDATA
//     section or processing instruction (every '<!' or '<?'): 139 to 187 B.
// With weights 8 / 3 / 3, a real Trendyol worksheet costs 100 B per unit (464 MB of
// DOM for 5 001 rows x 35 columns of its own rows) and the costliest shape measured
// (nested elements, `<si><t>` strings) 114 B per unit.
export const XML_ELEMENT_WEIGHT = 8;
export const XML_ATTRIBUTE_WEIGHT = 3;
// Text nodes, comments, CDATA sections and processing instructions.
export const XML_TEXT_NODE_WEIGHT = 3;
// Total DOM weight of the reader parts together; beyond it PAYLOAD_TOO_LARGE. Worst
// case about 570 MB of DOM (5 000 000 x 114 B). In practice the largest upload is
// about 5 000 rows x 35-40 columns: a real Trendyol export of 5 001 rows x 35 columns
// (about 4.9 million) passes, while 5 001 x 35 of distinct shared strings (about 5.9
// million) and every 5 001 x 64 sheet whose cells hold values (at least 22 per cell,
// about 7 million) are rejected. Real Trendyol files have at most 35 columns. The
// lasting fix is parsing in a memory-capped worker thread (the follow-up PR 2).
export const MAX_XML_DOM_WEIGHT = 5_000_000;
// Occurrences of the bytes 'xmlns' per reader part. Sibling declarations parse in
// linear time; nested ones are quadratic in depth: 256 nested declarations take about
// 4 ms to parse and 1 ms to serialize. xmldom's serializer copies the declarations in
// scope for every element, so 256 of them over 300 000 elements serialize in about
// 0.25 s instead of 0.09 s. Excel repeats a declaration on every
// x14:conditionalFormatting, so a real worksheet can carry 70 or more.
export const MAX_XMLNS_DECLARATIONS_PER_PART = 256;
// Workbook jobs in flight per process (the running one plus those waiting), beyond
// which a new call is refused with ENGINE_BUSY instead of queueing. Reads
// (readWorkbookGrid) and patches (patchWorkbook) share one queue, so this bounds them
// together. Jobs run one at a time, so the process peak memory stays at about one
// parse whatever the limit; the limit bounds the wait instead: one tenant's burst of
// large uploads cannot keep every other tenant's import or export waiting for minutes.
export const MAX_QUEUED_PARSES = 8;
// How long a read or a patch may wait in the shared queue for its turn; beyond it the
// call gives up with ENGINE_BUSY and its slot is freed. With up to MAX_QUEUED_PARSES
// calls ahead, the queue alone could otherwise hold a caller for several job durations.
export const PARSE_QUEUE_MAX_WAIT_MS = 20_000;
// Every read and every patch runs in one long-lived worker thread with these limits
// (see worker/grid-worker-host.ts). A job that exhausts the heap or runs past the time
// limit kills only the worker. The limits are a backstop, not the defence: one
// allocation larger than the remaining heap headroom plus about 16 MB still aborts the
// whole process, and memory outside the V8 heap (upload bytes, decoded text) is not
// counted, so every cap above stays. In budget, a parse peaks at about 760 MB (about
// 570 MB of DOM, up to 64 MB of worksheet source and of shared-string source, and up to
// about 60 MB of grid text), hence 1 024 MB of old generation.
export const GRID_WORKER_MAX_OLD_GENERATION_MB = 1024;
export const GRID_WORKER_MAX_YOUNG_GENERATION_MB = 64;
export const GRID_WORKER_TIMEOUT_MS = 30_000;
// Total length (UTF-16 code units) of every string cell of a returned grid. The grid
// is copied out of the worker, and the copy does not share repeated strings: 200 000
// cells referencing one 32 KB shared string would copy to about 6.4 GB.
export const MAX_GRID_TEXT_LENGTH = 16 * 1024 * 1024;
// Excel caps a custom number format code at 255 characters.
export const MAX_FORMAT_CODE_LENGTH = 255;
// UTF-16 code units of one decoded formula field the upload gate reads (formula-scan.ts).
// Excel caps a formula at 8 192 characters; the stored text adds the `_xlfn.` prefixes of
// newer functions, so four times that leaves headroom while bounding the NFKC form the
// scan builds, which can be eighteen times longer than the text.
export const MAX_FORMULA_TEXT_LENGTH = 32 * 1024;
// UTF-16 code units of formula text the upload gate reads in one upload: every formula
// field of every part, counted raw and in NFKC form; beyond it PAYLOAD_TOO_LARGE
// `formula-scan-budget`. The scan's cost grows with these units whatever the parts look
// like, and each field is bounded on its own (MAX_FORMULA_TEXT_LENGTH) but their number
// is not. Real exports charge at most 70 000 units, the 5 000-row commission source the
// size tests build about 5.9 million; the budget is four times that. In process, fields
// of U+FDFA up to the budget take about 1.4 s and the costliest shape measured (U+FDFB
// and U+3000 pairs) about 2.2 s, close to a legitimate parse of that 5 000-row source
// (about 1.8 s), so a crafted upload holds the shared queue about as long as a real
// large one does.
export const MAX_FORMULA_SCAN_UNITS = 24_000_000;
// SpreadsheetFileError meta `cause` is truncated: library messages may quote the input.
export const MAX_ERROR_CAUSE_LENGTH = 200;

// Export patch path (patchWorkbook). Every request is validated on the main thread
// before it is queued, then structured-cloned into the parse worker.
// Output files of one job: one per period plus the whole-week file; a week has at
// most 7 periods.
export const MAX_PATCH_OUTPUTS = 8;
// Cell patches of all outputs of one job together; the request is cloned into the
// worker.
export const MAX_PATCH_CELLS = 500_000;
// Anchor cells of one job: a few per data row; ABSOLUTE_MAX_ROWS is 20 000.
export const MAX_PATCH_ANCHORS = 100_000;
// Excel's cell text limit (UTF-16 code units). Also caps an anchor's `expected`.
export const MAX_PATCH_TEXT_LENGTH = 32_767;
// Characters of a number value.
export const MAX_PATCH_NUMBER_LENGTH = 64;
// UTF-16 code units of every patch value and every anchor `expected` of one request
// together (the size of MAX_GRID_TEXT_LENGTH). A structured clone does not share
// repeated strings; without this cap the per-value and per-count caps admit about
// 16 G units.
export const MAX_PATCH_REQUEST_TEXT_LENGTH = 16 * 1024 * 1024;
// Bytes of all changed outputs of one job together: ArrayBuffer memory, which the
// worker's resource limits do not count.
export const MAX_PATCH_OUTPUT_TOTAL_BYTES = 128 * 1024 * 1024;
// The patcher's own limits and constants live in patch/limits.ts, outside the
// package's exports.
// Multiplier of the row in cellKey; above ABSOLUTE_MAX_COLS, so every 1-based
// (row, column) pair maps to a distinct number that sorts in row-major order.
export const CELL_KEY_BASE = 1024;

// 'PK\x03\x04' — zip local-file-header signature (xlsx is a zip).
export const XLSX_MAGIC: readonly number[] = [0x50, 0x4b, 0x03, 0x04];
