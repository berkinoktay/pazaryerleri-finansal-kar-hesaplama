import { isSpreadsheetFileErrorCode, type SpreadsheetFileErrorCode } from '../errors';
import { isSheetData, type SheetData } from '../grid-types';
import { isResolvedPatchRequest, type ResolvedPatchRequest } from '../patch/patch-request';
import { isResolvedReadOptions, type ResolvedReadOptions } from '../read-options';
import { isRecord } from '../wire-guards';

// The messages between the worker host (main thread) and the grid worker. Both sides
// check what they receive: a structured clone keeps plain data only, so an error
// class does not survive the hop and is posted as its code, message and meta.

/**
 * One job: the upload's bytes (a copy, transferred) and either the resolved read
 * options of a grid read or the resolved request of a patch.
 */
export type GridWorkerRequest =
  | {
      readonly id: number;
      readonly kind: 'grid';
      readonly bytes: ArrayBuffer;
      readonly options: ResolvedReadOptions;
    }
  | {
      readonly id: number;
      readonly kind: 'patch';
      readonly bytes: ArrayBuffer;
      readonly request: ResolvedPatchRequest;
    };

/**
 * The answer to the request with the same `id`. `patched` holds one item per output
 * of the request, in order: the new archive (transferred; a fixed-length buffer that
 * no other item repeats), or null when the output changes nothing.
 */
export type GridWorkerResponse =
  | { readonly id: number; readonly kind: 'grid'; readonly grid: SheetData }
  | {
      readonly id: number;
      readonly kind: 'patched';
      readonly files: readonly (ArrayBuffer | null)[];
    }
  | {
      readonly id: number;
      readonly kind: 'file-error';
      readonly code: SpreadsheetFileErrorCode;
      readonly message: string;
      readonly meta: Readonly<Record<string, unknown>>;
    }
  | {
      readonly id: number;
      readonly kind: 'failure';
      readonly name: string;
      readonly message: string;
    };

/** A message without `kind`, or with a body of the other kind, is not a request. */
export function isGridWorkerRequest(value: unknown): value is GridWorkerRequest {
  if (!isRecord(value) || typeof value.id !== 'number' || !(value.bytes instanceof ArrayBuffer)) {
    return false;
  }
  switch (value.kind) {
    case 'grid':
      return isResolvedReadOptions(value.options);
    case 'patch':
      return isResolvedPatchRequest(value.request);
    default:
      return false;
  }
}

/**
 * Whether `buffer` can change its length (lib ES2022 does not declare `resizable`). A
 * view without a fixed length on such a buffer follows every resize.
 */
function isResizable(buffer: ArrayBuffer): boolean {
  return 'resizable' in buffer && buffer.resizable === true;
}

/**
 * True when `value` is an array whose every item is null or an ArrayBuffer of its own:
 * of fixed length, and not repeated (a structured clone keeps identity, so a buffer
 * posted twice arrives as one object in both places, and two outputs would share its
 * bytes). Indexed, not `every`, so a sparse array (a hole reads as `undefined`) is
 * rejected. The number of items is the host's to check: only it knows how many
 * outputs it sent.
 */
function isPatchedFiles(value: unknown): value is (ArrayBuffer | null)[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<ArrayBuffer>();
  for (let i = 0; i < value.length; i += 1) {
    const item: unknown = value[i];
    if (item === null) continue;
    if (!(item instanceof ArrayBuffer) || isResizable(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

export function isGridWorkerResponse(value: unknown): value is GridWorkerResponse {
  if (!isRecord(value) || typeof value.id !== 'number') return false;
  switch (value.kind) {
    case 'grid':
      return isSheetData(value.grid);
    case 'patched':
      return isPatchedFiles(value.files);
    case 'file-error':
      return (
        isSpreadsheetFileErrorCode(value.code) &&
        typeof value.message === 'string' &&
        isRecord(value.meta)
      );
    case 'failure':
      return typeof value.name === 'string' && typeof value.message === 'string';
    default:
      return false;
  }
}
