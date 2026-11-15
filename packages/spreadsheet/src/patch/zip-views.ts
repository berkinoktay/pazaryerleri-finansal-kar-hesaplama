import { Buffer } from 'node:buffer';

import { entryContent, type ZipEntry, type ZipLayout } from './raw-zip';
import { viewMismatch } from './shared';

// The view check: the parts the gate read from the local-header stream against the
// entries of the same names in the central directory, which the export path reads and
// rewrites. It runs inside the gate (guards.ts) over every XML part the gate kept and
// scanned, so a grid read and a patch job refuse the same files, and the bytes the gate
// judged are the bytes a second inflater (zlib, not fflate) reads from the directory.
// Lives apart from patch-upload.ts, which imports the gate.

// How the view check's messages start.
const KEPT_PART_ENTRY = 'Zip entry of a part the gate kept';

/** The layout's entries by name. */
export function entriesByName(layout: ZipLayout): Map<string, ZipEntry> {
  const entries = new Map<string, ZipEntry>();
  for (const entry of layout.entries) entries.set(entry.name, entry);
  return entries;
}

/** Whether `a` and `b` hold the same bytes; one native comparison, nothing copied. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);
}

/**
 * Throws SpreadsheetFileError CORRUPT_FILE `{ reason: 'zip-view-mismatch', entry }`
 * unless every part of `parts` (name, bytes the stream inflated) equals the content of
 * the directory's entry of that name. Every entry must exist and declare its part's
 * length before anything is inflated; the inflate is bounded by that length
 * (entryContent).
 */
export function assertSameViews(
  file: Uint8Array,
  layout: ZipLayout,
  parts: Iterable<readonly [string, Uint8Array]>,
): void {
  const entries = entriesByName(layout);
  const pairs: (readonly [ZipEntry, Uint8Array])[] = [];
  for (const [name, bytes] of parts) {
    const entry = entries.get(name);
    if (entry === undefined) {
      throw viewMismatch(name, `${KEPT_PART_ENTRY} is missing from the central directory`);
    }
    if (entry.uncompressedSize !== bytes.length) {
      throw viewMismatch(
        name,
        `${KEPT_PART_ENTRY} declares another length than the part the gate read`,
      );
    }
    pairs.push([entry, bytes]);
  }
  for (const [entry, bytes] of pairs) {
    if (!sameBytes(entryContent(file, entry), bytes)) {
      throw viewMismatch(
        entry.name,
        `${KEPT_PART_ENTRY} holds other bytes than the part the gate read`,
      );
    }
  }
}
