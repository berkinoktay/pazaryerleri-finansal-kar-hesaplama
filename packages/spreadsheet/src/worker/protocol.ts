import { isSpreadsheetFileErrorCode, type SpreadsheetFileErrorCode } from '../errors';
import { isSheetData, type SheetData } from '../grid-types';
import type { ResolvedReadOptions, SheetSelector } from '../read-options';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isSheetSelector(value: unknown): value is SheetSelector {
  if (!isRecord(value)) return false;
  switch (value.by) {
    case 'name':
      return typeof value.name === 'string';
    case 'index':
      return typeof value.index === 'number' && Number.isInteger(value.index) && value.index >= 0;
    default:
      return false;
  }
}

/** Resolved options; a strict `sheet` selector and a legacy `sheetName` never travel together. */
function isResolvedReadOptions(value: unknown): value is ResolvedReadOptions {
  return (
    isRecord(value) &&
    (value.sheetName === undefined || typeof value.sheetName === 'string') &&
    (value.sheet === undefined || isSheetSelector(value.sheet)) &&
    (value.sheet === undefined || value.sheetName === undefined) &&
    isPositiveInteger(value.rowCap) &&
    isPositiveInteger(value.colCap) &&
    isPositiveInteger(value.maxBytes)
  );
}

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
