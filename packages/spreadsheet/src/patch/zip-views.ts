import type { UploadParts } from '../guards';
import { entryContent, type ZipEntry, type ZipLayout } from './raw-zip';
import { bytesEqualAt, viewMismatch } from './shared';

// The view check: the parts the gate read from the local-header stream against the
// entries of the same names in the central directory, which the export path reads and
// rewrites. It runs inside the gate (guards.ts), so a grid read and a patch job refuse
// the same files. Lives apart from patch-upload.ts, which imports the gate.

// How the view check's messages start.
const READER_PART_ENTRY = 'Zip entry of a reader part';

/** The layout's entries by name. */
export function entriesByName(layout: ZipLayout): Map<string, ZipEntry> {
  const entries = new Map<string, ZipEntry>();
  for (const entry of layout.entries) entries.set(entry.name, entry);
  return entries;
}

/**
 * Throws SpreadsheetFileError CORRUPT_FILE `{ reason: 'zip-view-mismatch', entry }`
 * unless every part of `parts` equals the content of the directory's entry of that
 * name. Every entry must exist and declare its part's length before anything is
 * inflated; the inflate is bounded by that length (entryContent).
 */
export function assertSameViews(file: Uint8Array, layout: ZipLayout, parts: UploadParts): void {
  const entries = entriesByName(layout);
  const pairs: (readonly [ZipEntry, Uint8Array])[] = [];
  for (const [name, bytes] of Object.entries(parts)) {
    const entry = entries.get(name);
    if (entry === undefined) {
      throw viewMismatch(name, `${READER_PART_ENTRY} is missing from the central directory`);
    }
    if (entry.uncompressedSize !== bytes.length) {
      throw viewMismatch(
        name,
        `${READER_PART_ENTRY} declares another length than the part the gate read`,
      );
    }
    pairs.push([entry, bytes]);
  }
  for (const [entry, bytes] of pairs) {
    const content = entryContent(file, entry);
    if (content.length !== bytes.length || !bytesEqualAt(content, 0, bytes, 0, bytes.length)) {
      throw viewMismatch(
        entry.name,
        `${READER_PART_ENTRY} holds other bytes than the part the gate read`,
      );
    }
  }
}
