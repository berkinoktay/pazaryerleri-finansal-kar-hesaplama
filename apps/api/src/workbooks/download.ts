// How an export reaches the seller: the name of each output file, one HTTP download
// (a lone .xlsx, or a .zip of several window files) and the headers it is sent with.
// A download never carries the raw stored upload name: every name passes through
// `sanitizeUploadFilename` or comes from the format's fixed base.

import { zipSync } from 'fflate';

import { WorkbookConflictError } from '../lib/errors';
import type { FilenamePolicy } from './format';
import { contentDisposition, sanitizeUploadFilename } from './sanitize-upload-filename';
import { WorkbookInvariantError } from './workbook-errors';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const ZIP_MIME = 'application/zip';

const XLSX_EXTENSION = '.xlsx';
const ZIP_EXTENSION = '.zip';
const XLSX_EXTENSION_RE = /\.xlsx$/i;
// An xlsx is already deflated: store the entries, so several large files are not
// compressed again on the main thread.
const ZIP_STORE_LEVEL = 0;

export interface DownloadFile {
  readonly filename: string;
  readonly file: Buffer;
}

export interface DownloadBundle {
  readonly body: Buffer;
  readonly filename: string;
  readonly contentType: string;
}

/** The fallback name of a `source` policy: a fixed base, or the list name, then the default name. */
function sourceFallbackName(
  fallback: Extract<FilenamePolicy, { kind: 'source' }>['fallback'],
  source: { readonly name: string; readonly defaultName: string },
): string {
  switch (fallback.kind) {
    case 'fixed':
      return `${fallback.base}${XLSX_EXTENSION}`;
    case 'list-name':
      return (
        sanitizeUploadFilename(`${source.name}${XLSX_EXTENSION}`) ??
        `${source.defaultName}${XLSX_EXTENSION}`
      );
    default: {
      const exhaustive: never = fallback;
      throw new Error(`Unhandled filename fallback: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * One name per output file, in order:
 *   - fixed: `<base>.xlsx`;
 *   - window: `<base>-<dayCount>-<fileUnit>.xlsx`, and `<base>.xlsx` for a file without
 *     a day count (the zero-selection fallback);
 *   - source: the stored upload name once sanitized; a stored name that is null or does
 *     not sanitize (no `.xlsx`, nothing left) falls to the fallback: `<base>.xlsx`, or
 *     the sanitized list name, or `<defaultName>.xlsx`.
 */
export function downloadFilenames(
  policy: FilenamePolicy,
  source: {
    readonly name: string;
    readonly sourceFilename: string | null;
    readonly defaultName: string;
  },
  dayCounts: readonly (number | null)[],
): string[] {
  switch (policy.kind) {
    case 'fixed':
      return dayCounts.map(() => `${policy.base}${XLSX_EXTENSION}`);
    case 'window':
      return dayCounts.map((dayCount) =>
        dayCount === null
          ? `${policy.base}${XLSX_EXTENSION}`
          : `${policy.base}-${dayCount}-${policy.fileUnit}${XLSX_EXTENSION}`,
      );
    case 'source': {
      const stored =
        source.sourceFilename === null ? null : sanitizeUploadFilename(source.sourceFilename);
      const name = stored ?? sourceFallbackName(policy.fallback, source);
      return dayCounts.map(() => name);
    }
    default: {
      const exhaustive: never = policy;
      throw new Error(`Unhandled filename policy: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Throws WorkbookConflictError EXPORT_FILENAME_COLLISION when two of `names` are equal:
 * a zip would silently keep one of the files. The export checks its names this way
 * before the engine patches anything.
 */
export function assertDistinctFilenames(names: readonly string[]): void {
  if (new Set(names).size !== names.length) {
    throw new WorkbookConflictError('EXPORT_FILENAME_COLLISION');
  }
}

/** The name of a zip of several files: the policy's base, or the first file's stem. */
function zipName(policy: FilenamePolicy, first: DownloadFile): string {
  switch (policy.kind) {
    case 'fixed':
    case 'window':
      return `${policy.base}${ZIP_EXTENSION}`;
    case 'source':
      return first.filename.replace(XLSX_EXTENSION_RE, ZIP_EXTENSION);
    default: {
      const exhaustive: never = policy;
      throw new Error(`Unhandled filename policy: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * One HTTP download: a lone file as its .xlsx, several files as one .zip whose entries
 * are stored, not deflated. Throws WorkbookConflictError EXPORT_FILENAME_COLLISION when
 * two files share a name (a zip would silently keep one of them).
 */
export function bundleDownload(
  policy: FilenamePolicy,
  files: readonly DownloadFile[],
): DownloadBundle {
  const [first, ...rest] = files;
  if (first === undefined) throw new WorkbookInvariantError('An export produced no file');
  if (rest.length === 0) {
    return { body: first.file, filename: first.filename, contentType: XLSX_MIME };
  }
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    if (Object.hasOwn(entries, file.filename)) {
      throw new WorkbookConflictError('EXPORT_FILENAME_COLLISION');
    }
    // A Buffer is a Uint8Array: the zip reads each patched file in place, no copy.
    entries[file.filename] = file.file;
  }
  const zipped = zipSync(entries, { level: ZIP_STORE_LEVEL });
  return {
    // A view of the zip's bytes, not a copy of them.
    body: Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength),
    filename: zipName(policy, first),
    contentType: ZIP_MIME,
  };
}

/** The headers a download is sent with. */
export function downloadHeaders(bundle: DownloadBundle): Record<string, string> {
  return {
    'Content-Type': bundle.contentType,
    'Content-Length': String(bundle.body.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': contentDisposition(bundle.filename),
  };
}
