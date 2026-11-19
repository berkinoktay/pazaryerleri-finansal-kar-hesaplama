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
// Total DOM weight of the reader parts together; beyond it PAYLOAD_TOO_LARGE (reason
// `dom-weight`). Sized for a full commission tariff file as exported: 1 header row and
// 5 000 product rows (the row cap admits row numbers up to rowCap + 1),
// every row as heavy as the heaviest row of the committed export and carrying the
// per-row data validation the export writes. As exported it weighs about 5.63 million
// with two periods (35 columns) and about 6.67 million with three (41 columns), which
// leaves about 65 units per row to spare: room for two of the row's four empty cells
// (size, new price, two external ids) filled with inline text (22 each), not three. Not
// every such file passes: the three-period file with all four filled weighs about 7.11
// million and is refused from about 4 920 product rows on, and each further period adds
// 6 columns, so a wider real file reaches this limit below 5 000 rows. It still rejects
// every 5 001 x 64 sheet whose cells carry their reference and hold values (at least 22
// per cell, about 7.1 million: only about 1% over, so re-check this on any raise; the
// reader refuses a cell without a reference) and 5 001 x 64 of distinct shared strings
// (about 10.6 million). What it costs, measured 2026-11-19 on a developer
// laptop in the real parse worker: files crafted to weigh just under this cap needed at
// most about 783 MB of old generation to read (a 64-column number grid, and rich-text
// shared strings), at most about 798 MB to patch once (the import's rehearsal, two
// writes per row; the number grid with its worksheet source padded to about 31 MB) and
// about 828 MB to patch the same grid into eight outputs (MAX_PATCH_OUTPUTS, the most an
// export writes). The heaviest commission file it admits (three periods, all four cells
// filled, 4 920 product rows) needed about 722 MB to patch, into one output or eight.
// The same crafted shapes at the earlier 5 000 000 needed at most about 584 MB to read.
export const MAX_XML_DOM_WEIGHT = 7_000_000;
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
// counted, so every cap above stays. In budget that abort is out of reach: the caps
// bound every single allocation of a job, and the largest are the text of one XML part
// (the parts hold at most MAX_XML_TOTAL_BYTES, 32 MiB, together; twice that as a
// two-byte string) and the strings of a grid (MAX_GRID_TEXT_LENGTH), both far under the
// headroom below. Measured 2026-11-19 on a developer laptop (reads and patches of files
// crafted to weigh just under MAX_XML_DOM_WEIGHT; the old-generation limit found by
// binary search in 16 MB steps): the costliest shapes needed about 783 MB of old
// generation to read, about 798 MB to patch once and about 828 MB to patch into eight
// outputs, about 195 MB under the 1 024 MB; filling the worksheet source to about 31 MB
// with non-Latin1 text, or referencing one 9-million-character shared string, did not
// raise the read. The slowest job (a patch into eight outputs) took about 13 s at its
// minimum heap and at most about 10 s at 1 024 MB, under the 30 s time limit; slower or
// busier hardware has less margin. A read and a patch of the full three-period
// commission file as exported also run under these limits in the CI-only test of
// worker/grid-worker-host.test.ts. A raise of MAX_XML_DOM_WEIGHT needs this measured
// again.
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
// field of every part, counted raw, plus its NFKC form when that differs (the scan reads
// the NFKC form only then); beyond it PAYLOAD_TOO_LARGE `formula-scan-budget`. The scan's
// cost grows with these units whatever the parts look like, and each field is bounded on
// its own (MAX_FORMULA_TEXT_LENGTH) but their number is not. No formula field of a real
// export changes under NFKC: real exports charge at most about 35 000 units, the 5 000-row
// commission source the size tests build about 2.9 million; the budget is four times
// that. Every field is still normalised, so the costliest shape measured is one NFKC
// keeps: fields of one-mark names (U+0345) each followed by a line separator (U+2028) take
// about 2.5 s in process up to the budget, as long as the same file took under the
// earlier 24 000 000 that charged both forms of every field. Fields of U+FDFB and U+3000
// pairs, which NFKC changes, take about 1.1 s (2.3 s under the earlier budget). A
// legitimate parse of that 5 000-row source took about 1.8 s, so a crafted upload holds
// the shared queue about as long as a real large one does.
export const MAX_FORMULA_SCAN_UNITS = 12_000_000;
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
