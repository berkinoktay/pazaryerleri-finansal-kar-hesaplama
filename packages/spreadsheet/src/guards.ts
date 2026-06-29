import { Unzip, UnzipInflate } from 'fflate';
import { SpreadsheetFileError } from './errors';
import { readSheetDimensions } from './sheet-meta';
import { XLSX_MAGIC, MAX_ZIP_ENTRIES, MAX_DECOMPRESSED_BYTES, MAX_TOTAL_CELLS } from './constants';

interface GuardOpts {
  rowCap: number;
  colCap: number;
  maxBytes: number;
  /** Callers may LOWER this below MAX_DECOMPRESSED_BYTES (e.g. in tests); raising above the absolute cap is silently clamped. */
  maxDecompressedBytes?: number;
}

function hasXlsxMagic(file: Buffer): boolean {
  // XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04] — zip local-file-header signature.
  // With noUncheckedIndexedAccess, file[i] is number | undefined; comparing to
  // number is valid strict equality (undefined === 0x50 is false, so every() returns false).
  return XLSX_MAGIC.every((b, i) => file[i] === b);
}

/**
 * Validates an xlsx Buffer for security and structural integrity before any parsing.
 *
 * Check order:
 *   1. Compressed file size cap (no attacker-controlled metadata involved).
 *   2. Magic bytes — zip local-file-header PK\x03\x04 signature.
 *   3. Streaming decompress guard — inflated bytes are counted with a running ceiling
 *      using fflate's Unzip + UnzipInflate. The ceiling fires from REAL inflated bytes,
 *      not from the central-directory originalSize field (which is attacker-controlled
 *      and bypassable with the unzipSync-filter approach).
 *      effectiveDecompCap = min(opts.maxDecompressedBytes, MAX_DECOMPRESSED_BYTES):
 *      callers may lower but never raise above the engine's absolute cap.
 *      NOTE: we set a flag in ondata rather than throwing; fflate catches throws from
 *      ondata and re-delivers them as the `err` arg, which would lose the original code.
 *      The flag is checked between chunk pushes so the loop aborts early.
 *   4. Structural check — entry list must contain [Content_Types].xml + xl/workbook.xml.
 *      Magic bytes alone only prove "is a zip"; a .docx or .jar also starts with PK.
 *   5. Dimension caps — per-sheet row, col, and total-cell ceilings via readSheetDimensions.
 *      Safe here because total inflation is already proven bounded by step 3.
 *
 * Throws SpreadsheetFileError on any violation. This function is INTERNAL;
 * it is wired into parseXlsx and is not part of the public package surface.
 */
export function assertValidUpload(file: Buffer, opts: GuardOpts): void {
  // 1. Compressed size cap
  if (file.length > opts.maxBytes) {
    throw new SpreadsheetFileError(
      'PAYLOAD_TOO_LARGE',
      `File ${file.length}B exceeds ${opts.maxBytes}B`,
      { maxBytes: opts.maxBytes, received: file.length },
    );
  }

  // 2. Magic bytes: first 4 bytes must be PK\x03\x04
  if (!hasXlsxMagic(file)) {
    throw new SpreadsheetFileError(
      'NOT_XLSX',
      'Missing zip magic bytes — not a zip or xlsx file',
      {},
    );
  }

  // 3. Streaming decompress guard
  //    effectiveDecompCap clamps the caller's override downward only; raising above
  //    MAX_DECOMPRESSED_BYTES is silently clamped to MAX_DECOMPRESSED_BYTES.
  const effectiveDecompCap = Math.min(
    opts.maxDecompressedBytes ?? MAX_DECOMPRESSED_BYTES,
    MAX_DECOMPRESSED_BYTES,
  );

  let totalDecompressed = 0;
  const entryNames: string[] = [];

  // abortReason is set (not thrown) inside onfile/ondata callbacks because fflate
  // catches throws from ondata and re-delivers them as the `err` argument on the next
  // call, which would cause us to lose the original error code. Instead we:
  //   (a) set abortReason in the callback,
  //   (b) return early from remaining ondata calls once abortReason is set,
  //   (c) break the chunk push loop on the next iteration,
  //   (d) throw abortReason after the loop.
  let abortReason: SpreadsheetFileError | null = null;

  const unzipper = new Unzip();
  unzipper.register(UnzipInflate); // Required for DEFLATE (compression method 8)

  unzipper.onfile = (f) => {
    entryNames.push(f.name);
    if (entryNames.length > MAX_ZIP_ENTRIES) {
      abortReason = new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Too many zip entries', {
        entries: entryNames.length,
      });
      // Do not call f.start() — no callbacks will fire for this entry.
      return;
    }
    // AsyncFlateStreamHandler = (err: FlateError | null, data: Uint8Array, final: boolean) => void.
    // Trailing `final` parameter is omitted — TypeScript allows fewer params than the type requires.
    f.ondata = (err, chunk) => {
      if (abortReason !== null) return; // already decided; ignore remaining callbacks
      if (err !== null) {
        abortReason = new SpreadsheetFileError(
          'CORRUPT_FILE',
          'Inflate failed during streaming guard',
          {},
        );
        return;
      }
      totalDecompressed += chunk.length;
      if (totalDecompressed > effectiveDecompCap) {
        abortReason = new SpreadsheetFileError(
          'PAYLOAD_TOO_LARGE',
          'Decompressed size exceeds cap',
          { cap: effectiveDecompCap },
        );
      }
    };
    // start() MUST be called to begin receiving ondata callbacks
    f.start();
  };

  // Feed in 64 KB chunks so that abortReason is checked between pushes and the
  // loop breaks early (the first chunk boundary after the cap is hit).
  const bytes = new Uint8Array(file);
  const CHUNK_SIZE = 64 * 1024;
  try {
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      // Check BEFORE pushing the next chunk so we stop as soon as possible.
      if (abortReason !== null) break;
      const isLast = i + CHUNK_SIZE >= bytes.length;
      unzipper.push(bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length)), isLast);
    }
  } catch (e) {
    // fflate itself threw (e.g. structural zip corruption not handled by ondata).
    // Don't override an already-set abortReason.
    if (abortReason === null) {
      if (e instanceof SpreadsheetFileError) throw e;
      abortReason = new SpreadsheetFileError(
        'CORRUPT_FILE',
        'Unexpected error during zip inspection',
        { cause: String(e) },
      );
    }
  }

  // Throw the first violation recorded during streaming (if any).
  if (abortReason !== null) throw abortReason;

  // 4. Structural check: presence of required xlsx part names.
  //    entryNames is populated by onfile which fires for all entries regardless
  //    of compression method — so this check is reliable even for stored entries.
  if (!entryNames.includes('[Content_Types].xml') || !entryNames.includes('xl/workbook.xml')) {
    throw new SpreadsheetFileError(
      'NOT_XLSX',
      'Not an xlsx file — missing required workbook parts ([Content_Types].xml, xl/workbook.xml)',
      { found: entryNames },
    );
  }

  // 5. Dimension caps — total inflation is bounded by step 3, so readSheetDimensions is safe.
  const dims = readSheetDimensions(file);
  for (const d of dims) {
    if (d.cols > opts.colCap) {
      throw new SpreadsheetFileError(
        'COL_CAP_EXCEEDED',
        `Sheet '${d.sheetPath}' has ${d.cols} cols — exceeds cap ${opts.colCap}`,
        { cols: d.cols, colCap: opts.colCap },
      );
    }
    if (d.rows > opts.rowCap + 1) {
      throw new SpreadsheetFileError(
        'ROW_CAP_EXCEEDED',
        `Sheet '${d.sheetPath}' has ${d.rows} rows — exceeds cap`,
        { rows: d.rows, rowCap: opts.rowCap },
      );
    }
    if (d.rows * d.cols > MAX_TOTAL_CELLS) {
      throw new SpreadsheetFileError(
        'ROW_CAP_EXCEEDED',
        `Sheet '${d.sheetPath}' total cells (${d.rows * d.cols}) exceeds cap ${MAX_TOTAL_CELLS}`,
        { cells: d.rows * d.cols, cap: MAX_TOTAL_CELLS },
      );
    }
  }
}
