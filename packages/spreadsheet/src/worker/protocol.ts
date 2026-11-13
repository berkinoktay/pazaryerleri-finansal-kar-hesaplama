import { isSpreadsheetFileErrorCode, type SpreadsheetFileErrorCode } from '../errors';
import { isSheetData, type SheetData } from '../grid-types';
import { isResolvedReadOptions, type ResolvedReadOptions } from '../read-options';
import { isRecord } from '../wire-guards';

// The messages between the worker host (main thread) and the grid worker. Both sides
// check what they receive: a structured clone keeps plain data only, so an error
// class does not survive the hop and is posted as its code, message and meta.

/** One parse: the upload's bytes (a copy, transferred) and the resolved read options. */
export interface GridWorkerRequest {
  readonly id: number;
  readonly bytes: ArrayBuffer;
  readonly options: ResolvedReadOptions;
}

/** The answer to the request with the same `id`. */
export type GridWorkerResponse =
  | { readonly id: number; readonly kind: 'grid'; readonly grid: SheetData }
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

export function isGridWorkerRequest(value: unknown): value is GridWorkerRequest {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    value.bytes instanceof ArrayBuffer &&
    isResolvedReadOptions(value.options)
  );
}

export function isGridWorkerResponse(value: unknown): value is GridWorkerResponse {
  if (!isRecord(value) || typeof value.id !== 'number') return false;
  switch (value.kind) {
    case 'grid':
      return isSheetData(value.grid);
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
