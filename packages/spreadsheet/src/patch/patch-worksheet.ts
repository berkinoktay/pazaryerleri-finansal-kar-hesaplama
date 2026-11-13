import { Buffer } from 'node:buffer';

import { ABSOLUTE_MAX_COLS } from '../constants';
import { SpreadsheetFileError } from '../errors';
import { columnLetters } from '../sheet-meta';
import { assertWritableValue, escapeXmlText, needsSpacePreserve } from './cell-values';
import {
  PATCH_GROWTH_DENOMINATOR,
  PATCH_GROWTH_FLOOR_BYTES,
  PATCH_GROWTH_NUMERATOR,
} from './limits';
import { copyCellPatch, type CellPatch, type CellPatchValue } from './patch-request';
import { MALFORMED_SHEET_REASONS, PATCH_LIMIT_REASONS } from './reasons';
import { RejectedRows } from './rejected-rows';
import { invalidPatchRequest } from './shared';
import type { SheetIndex } from './sheet-index';
import {
  ATTRIBUTE_NAME_END,
  ATTRIBUTE_NAME_START,
  ATTRIBUTE_VALUE_END,
  attributeField,
  bytesEqualAscii,
  createMarkup,
  localNameIs,
  NAME_DECODER,
  nextMarkup,
  scanMarkup,
  SPACE,
  TAG_OPEN,
  valueAt,
  type XmlMarkup,
} from './xml-lexer';

// The cell patcher of the export path: writes one output's cell patches into a
// worksheet part through its index (sheet-index.ts), as byte edits. Untouched bytes
// are copied, never decoded and re-encoded; a rebuilt cell keeps the source bytes of
// its attributes.
//
// One pass merges the patch list with the index. Rows of both go up, and inside a row
// so do cells and patches, so no patch searches for its row or its cell. The same pass
// enforces the precondition of every patch (resolvePatchRequest already did on the
// main thread, but a number goes into <v> unescaped and an unsorted list would make
// the merge skip patches) and collects every rejected patch, so one error reports all
// of them. Edits are parallel arrays, at most one entry per patch; the result is sized
// from two running totals and allocated once, after the rejections and the cap.

export interface WorksheetPatchOptions {
  /** 0-based columns whose formula cells may be overwritten. */
  readonly overwriteFormulaColumns: ReadonlySet<number>;
  /** Cap on the patched part, in bytes. */
  readonly maxBytes: number;
}

export interface WorksheetPatchResult {
  /** `index.bytes` itself when `changed` is false. */
  readonly bytes: Uint8Array;
  readonly changed: boolean;
  readonly formulasRemoved: number;
}

/** What the direct children of a cell hold: no `f`, a plain `f`, or an `f` with a `t` attribute. */
type FormulaKind = 'none' | 'plain' | 'typed';

/** A value that writes content; `clear` writes none. */
type ContentValue = Exclude<CellPatchValue, { readonly kind: 'clear' }>;

/** The MALFORMED_SHEET reasons a rejected formula target carries. */
type FormulaReason =
  | typeof MALFORMED_SHEET_REASONS.SHARED_FORMULA
  | typeof MALFORMED_SHEET_REASONS.FORMULA_TARGET;

const FORMULA_ELEMENT = 'f';
const TYPE_ATTRIBUTE = 't';
const INLINE_STRING_TYPE = ' t="inlineStr"';
const SPACE_PRESERVE = ' xml:space="preserve"';
const PREFIX_SEPARATOR = ':';
const NO_PREFIX = '';
const EMPTY_TAG_CLOSE = '/>';
// An attribute's bytes run from its name through the quote after its value.
const CLOSING_QUOTE_LENGTH = 1;
// Before any patch: every real patch (row >= 1, column >= 0) comes after it.
const NO_PREVIOUS_ROW = 0;
const NO_PREVIOUS_COLUMN = -1;
const NO_ROW = -1;

const encoder = new TextEncoder();

function growthError(cap: number): SpreadsheetFileError {
  return new SpreadsheetFileError(
    'PAYLOAD_TOO_LARGE',
    `Patched worksheet part would exceed ${cap}B`,
    { reason: PATCH_LIMIT_REASONS.GROWTH, cap },
  );
}

/** UTF-8 length of a well-formed string (no lone surrogate: the values were checked). */
function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** The prefix of a qualified name with its colon, or '' when it has none. */
function prefixOf(qualifiedName: string): string {
  const colon = qualifiedName.indexOf(PREFIX_SEPARATOR);
  return colon === -1 ? NO_PREFIX : qualifiedName.slice(0, colon + PREFIX_SEPARATOR.length);
}

function numberContent(prefix: string, value: string): string {
  return `<${prefix}v>${value}</${prefix}v>`;
}

function textContent(prefix: string, value: string): string {
  const space = needsSpacePreserve(value) ? SPACE_PRESERVE : '';
  return `<${prefix}is><${prefix}t${space}>${escapeXmlText(value)}</${prefix}t></${prefix}is>`;
}

/** What follows the kept attributes of a rebuilt cell named `qualifiedName`. */
function rebuiltCellTail(qualifiedName: string, value: CellPatchValue): string {
  const prefix = prefixOf(qualifiedName);
  switch (value.kind) {
    case 'number':
      return `>${numberContent(prefix, value.value)}</${qualifiedName}>`;
    case 'text':
      return `${INLINE_STRING_TYPE}>${textContent(prefix, value.value)}</${qualifiedName}>`;
    case 'clear':
      return EMPTY_TAG_CLOSE;
    default: {
      const _exhaustive: never = value;
      throw new Error(`Unhandled cell value kind: ${String(_exhaustive)}`);
    }
  }
}

/** A new cell `reference` under a row whose prefix is `prefix`; no `s`. */
function insertedCell(prefix: string, reference: string, value: ContentValue): string {
  switch (value.kind) {
    case 'number':
      return `<${prefix}c r="${reference}">${numberContent(prefix, value.value)}</${prefix}c>`;
    case 'text':
      return `<${prefix}c r="${reference}"${INLINE_STRING_TYPE}>${textContent(prefix, value.value)}</${prefix}c>`;
    default: {
      const _exhaustive: never = value;
      throw new Error(`Unhandled cell value kind: ${String(_exhaustive)}`);
    }
  }
}

/** Bytes [start, end) of the part, then `text`, as one piece. */
function bytesThenText(bytes: Uint8Array, start: number, end: number, text: string): Uint8Array {
  const piece = new Uint8Array(end - start + utf8Length(text));
  piece.set(bytes.subarray(start, end));
  encoder.encodeInto(text, piece.subarray(end - start));
  return piece;
}

class CellPatcher {
  private readonly index: SheetIndex;
  private readonly bytes: Uint8Array;
  private readonly patches: readonly CellPatch[];
  private readonly options: WorksheetPatchOptions;
  private readonly markup: XmlMarkup = createMarkup();
  private readonly attributes: number[] = [];

  private previousRow = NO_PREVIOUS_ROW;
  private previousColumn = NO_PREVIOUS_COLUMN;

  // Merge cursors: both only move forward.
  private rowCursor = 0;
  private cellCursor = 0;
  // The row of the current group of patches: its number, its index row (NO_ROW when
  // the part has no such row), and its qualified name once an insert needed it.
  private groupRowNumber = NO_PREVIOUS_ROW;
  private groupRow = NO_ROW;
  private groupRowName: string | null = null;
  // New cells of a self-closing group row: written as one edit when the group ends.
  // Their bytes count toward the early exit as each is planned, not when it is written.
  private readonly reopenedCells: string[] = [];
  private reopenedBytes = 0;

  // At most one edit per patch: replace part bytes [start, end) with the piece.
  private readonly editStart: number[] = [];
  private readonly editEnd: number[] = [];
  private readonly editPiece: Uint8Array[] = [];
  private removedBytes = 0;
  private addedBytes = 0;
  private formulasRemoved = 0;

  // Patches rejected for each reason. The walk meets rows in ascending order, so each
  // add is constant time.
  private readonly missingRows = new RejectedRows();
  private readonly sharedFormulas = new RejectedRows();
  private readonly formulaTargets = new RejectedRows();

  constructor(index: SheetIndex, patches: readonly CellPatch[], options: WorksheetPatchOptions) {
    this.index = index;
    this.bytes = index.bytes;
    this.patches = patches;
    this.options = options;
  }

  run(): WorksheetPatchResult {
    for (let position = 0; position < this.patches.length; position += 1) {
      const given = this.patches[position];
      if (given === undefined) throw invalidPatchRequest(`patch ${position} is missing`);
      // Checked and written from one plain copy: every field is read exactly once.
      const patch = copyCellPatch(given);
      this.checkPatch(patch);
      this.apply(patch);
    }
    this.closeGroup();
    this.rejectCollected();
    const size = this.bytes.length - this.removedBytes + this.addedBytes;
    if (size > this.options.maxBytes) throw growthError(this.options.maxBytes);
    if (this.editPiece.length === 0) {
      return { bytes: this.bytes, changed: false, formulasRemoved: 0 };
    }
    return { bytes: this.assemble(size), changed: true, formulasRemoved: this.formulasRemoved };
  }

  /** The precondition, before the patch is used: a caller bug throws at once. */
  private checkPatch(patch: CellPatch): void {
    const { excelRow, col } = patch;
    if (!Number.isInteger(excelRow) || excelRow < 1) {
      throw invalidPatchRequest(`patch row ${String(excelRow)} is not an integer of at least 1`);
    }
    if (!Number.isInteger(col) || col < 0 || col >= ABSOLUTE_MAX_COLS) {
      throw invalidPatchRequest(
        `patch column ${String(col)} is outside 0..${ABSOLUTE_MAX_COLS - 1}`,
      );
    }
    const after =
      excelRow > this.previousRow || (excelRow === this.previousRow && col > this.previousColumn);
    if (!after) {
      throw invalidPatchRequest(
        `patch on row ${excelRow}, column ${col} is out of order or repeats a cell`,
      );
    }
    assertWritableValue(patch.value);
    this.previousRow = excelRow;
    this.previousColumn = col;
  }

  private apply(patch: CellPatch): void {
    const row = this.enterRow(patch.excelRow);
    if (row === NO_ROW) {
      this.missingRows.add(patch.excelRow);
      return;
    }
    const column = patch.col + 1;
    const cellColumn = this.index.cellColumn;
    const nextRowFirstCell = valueAt(this.index.rowFirstCell, row + 1);
    while (this.cellCursor < nextRowFirstCell && valueAt(cellColumn, this.cellCursor) < column) {
      this.cellCursor += 1;
    }
    if (this.cellCursor < nextRowFirstCell && valueAt(cellColumn, this.cellCursor) === column) {
      this.overwrite(this.cellCursor, patch);
      return;
    }
    this.insert(row, nextRowFirstCell, patch);
  }

  /** The index row of `excelRow`, or NO_ROW; a new row closes the previous group. */
  private enterRow(excelRow: number): number {
    if (excelRow === this.groupRowNumber) return this.groupRow;
    this.closeGroup();
    const rowNumber = this.index.rowNumber;
    while (this.rowCursor < rowNumber.length && valueAt(rowNumber, this.rowCursor) < excelRow) {
      this.rowCursor += 1;
    }
    const found =
      this.rowCursor < rowNumber.length && valueAt(rowNumber, this.rowCursor) === excelRow;
    this.groupRowNumber = excelRow;
    this.groupRow = found ? this.rowCursor : NO_ROW;
    this.groupRowName = null;
    if (found) this.cellCursor = valueAt(this.index.rowFirstCell, this.rowCursor);
    return this.groupRow;
  }

  /**
   * A self-closing group row with new cells becomes one edit over the whole row: the
   * start tag without its '/', the new cells, then the row's end tag.
   */
  private closeGroup(): void {
    if (this.reopenedCells.length === 0) return;
    const row = this.groupRow;
    const start = valueAt(this.index.rowStart, row);
    const end = valueAt(this.index.rowEnd, row);
    const tail = `>${this.reopenedCells.join('')}</${this.rowName(row)}>`;
    this.reopenedCells.length = 0;
    this.reopenedBytes = 0;
    this.record(start, end, bytesThenText(this.bytes, start, end - EMPTY_TAG_CLOSE.length, tail));
  }

  /** The qualified name of the group row's start tag; scanned once per group. */
  private rowName(row: number): string {
    if (this.groupRowName !== null) return this.groupRowName;
    scanMarkup(this.bytes, valueAt(this.index.rowStart, row), this.markup);
    const name = NAME_DECODER.decode(
      this.bytes.subarray(this.markup.nameStart, this.markup.nameEnd),
    );
    this.groupRowName = name;
    return name;
  }

  private overwrite(cell: number, patch: CellPatch): void {
    const start = valueAt(this.index.cellStart, cell);
    const end = valueAt(this.index.cellEnd, cell);
    const formula = this.formulaKind(valueAt(this.index.cellTagEnd, cell), end);
    switch (formula) {
      case 'typed':
        this.sharedFormulas.add(patch.excelRow);
        return;
      case 'plain':
        if (!this.options.overwriteFormulaColumns.has(patch.col)) {
          this.formulaTargets.add(patch.excelRow);
          return;
        }
        this.formulasRemoved += 1;
        break;
      case 'none':
        break;
      default: {
        const _exhaustive: never = formula;
        throw new Error(`Unhandled formula kind: ${String(_exhaustive)}`);
      }
    }
    this.record(start, end, this.rebuiltCell(start, patch.value));
  }

  private insert(row: number, nextRowFirstCell: number, patch: CellPatch): void {
    const value = patch.value;
    if (value.kind === 'clear') return;
    const reference = `${columnLetters(patch.col + 1)}${patch.excelRow}`;
    const cell = insertedCell(prefixOf(this.rowName(row)), reference, value);
    const rowTagEnd = valueAt(this.index.rowTagEnd, row);
    if (valueAt(this.index.rowEnd, row) === rowTagEnd) {
      this.reopenedCells.push(cell);
      this.reopenedBytes += utf8Length(cell);
      if (this.addedBytes + this.reopenedBytes > this.options.maxBytes) {
        throw growthError(this.options.maxBytes);
      }
      return;
    }
    const at = this.insertOffset(row, nextRowFirstCell, rowTagEnd);
    this.record(at, at, encoder.encode(cell));
  }

  /** Before the first cell with a greater column; else after the row's last cell; else after the start tag. */
  private insertOffset(row: number, nextRowFirstCell: number, rowTagEnd: number): number {
    if (this.cellCursor < nextRowFirstCell) return valueAt(this.index.cellStart, this.cellCursor);
    if (nextRowFirstCell > valueAt(this.index.rowFirstCell, row)) {
      return valueAt(this.index.cellEnd, nextRowFirstCell - 1);
    }
    return rowTagEnd;
  }

  /** Scans the cell's direct children (bytes [contentStart, end)) for an `f` element. */
  private formulaKind(contentStart: number, end: number): FormulaKind {
    let kind: FormulaKind = 'none';
    let depth = 0;
    let position = contentStart;
    while (position < end) {
      const at = nextMarkup(this.bytes, position);
      if (at === -1 || at >= end) break;
      scanMarkup(this.bytes, at, this.markup, this.attributes);
      position = this.markup.end;
      const markupKind = this.markup.kind;
      switch (markupKind) {
        case 'start':
        case 'empty':
          if (depth === 0 && this.isFormulaElement()) {
            if (this.hasTypeAttribute()) return 'typed';
            kind = 'plain';
          }
          if (markupKind === 'start') depth += 1;
          break;
        case 'end':
          depth -= 1;
          break;
        case 'opaque':
          break;
        default: {
          const _exhaustive: never = markupKind;
          throw new Error(`Unhandled markup kind: ${String(_exhaustive)}`);
        }
      }
    }
    return kind;
  }

  private isFormulaElement(): boolean {
    return localNameIs(this.bytes, this.markup, FORMULA_ELEMENT);
  }

  private hasTypeAttribute(): boolean {
    for (let attribute = 0; attribute < this.markup.attributeCount; attribute += 1) {
      if (this.isTypeAttribute(attribute)) return true;
    }
    return false;
  }

  /** Whether attribute `attribute` of the last scanned tag is named exactly `t`. */
  private isTypeAttribute(attribute: number): boolean {
    return bytesEqualAscii(
      this.bytes,
      attributeField(this.attributes, attribute, ATTRIBUTE_NAME_START),
      attributeField(this.attributes, attribute, ATTRIBUTE_NAME_END),
      TYPE_ATTRIBUTE,
    );
  }

  /**
   * The cell at `start` rebuilt: '<' and its qualified name; every attribute not
   * named exactly `t`, each as one space and its source bytes from the name through
   * the closing quote; then the value's type, content and close.
   */
  private rebuiltCell(start: number, value: CellPatchValue): Uint8Array {
    const bytes = this.bytes;
    const markup = this.markup;
    scanMarkup(bytes, start, markup, this.attributes);
    const { nameStart, nameEnd, attributeCount } = markup;
    const tail = rebuiltCellTail(NAME_DECODER.decode(bytes.subarray(nameStart, nameEnd)), value);
    let size = 1 + (nameEnd - nameStart) + utf8Length(tail);
    for (let attribute = 0; attribute < attributeCount; attribute += 1) {
      if (this.isTypeAttribute(attribute)) continue;
      const attributeStart = attributeField(this.attributes, attribute, ATTRIBUTE_NAME_START);
      size += 1 + this.attributeEnd(attribute) - attributeStart;
    }
    const piece = new Uint8Array(size);
    piece[0] = TAG_OPEN;
    piece.set(bytes.subarray(nameStart, nameEnd), 1);
    let at = 1 + nameEnd - nameStart;
    for (let attribute = 0; attribute < attributeCount; attribute += 1) {
      if (this.isTypeAttribute(attribute)) continue;
      const attributeStart = attributeField(this.attributes, attribute, ATTRIBUTE_NAME_START);
      const attributeEnd = this.attributeEnd(attribute);
      piece[at] = SPACE;
      piece.set(bytes.subarray(attributeStart, attributeEnd), at + 1);
      at += 1 + attributeEnd - attributeStart;
    }
    encoder.encodeInto(tail, piece.subarray(at));
    return piece;
  }

  /** Just past the closing quote of attribute `attribute`. */
  private attributeEnd(attribute: number): number {
    return attributeField(this.attributes, attribute, ATTRIBUTE_VALUE_END) + CLOSING_QUOTE_LENGTH;
  }

  private record(start: number, end: number, piece: Uint8Array): void {
    this.editStart.push(start);
    this.editEnd.push(end);
    this.editPiece.push(piece);
    this.removedBytes += end - start;
    this.addedBytes += piece.length;
    // The final size is at least the bytes added: past the cap here, nothing a later
    // patch removes can bring it back, so stop before planning more pieces.
    if (this.addedBytes > this.options.maxBytes) throw growthError(this.options.maxBytes);
  }

  /** Missing rows first, then shared formulas, then formulas in unflagged columns. */
  private rejectCollected(): void {
    const missing = this.missingRows;
    if (missing.count > 0) {
      throw new SpreadsheetFileError(
        'ROW_NOT_FOUND',
        `${missing.count} cell patches target rows the worksheet part does not have`,
        { count: missing.count, rows: missing.rows },
      );
    }
    if (this.sharedFormulas.count > 0) {
      throw this.formulaError(
        MALFORMED_SHEET_REASONS.SHARED_FORMULA,
        this.sharedFormulas,
        'a shared, array or data table formula',
      );
    }
    if (this.formulaTargets.count > 0) {
      throw this.formulaError(
        MALFORMED_SHEET_REASONS.FORMULA_TARGET,
        this.formulaTargets,
        'a formula in a column that may not be overwritten',
      );
    }
  }

  private formulaError(
    reason: FormulaReason,
    rejected: RejectedRows,
    what: string,
  ): SpreadsheetFileError {
    return new SpreadsheetFileError(
      'MALFORMED_SHEET',
      `${rejected.count} cell patches target ${what}`,
      { reason, count: rejected.count, rows: rejected.rows },
    );
  }

  /** The untouched runs and the pieces, in order, into one allocation of `size` bytes. */
  private assemble(size: number): Uint8Array {
    const source = this.bytes;
    const result = new Uint8Array(size);
    let cursor = 0;
    let written = 0;
    let edit = 0;
    for (const piece of this.editPiece) {
      const start = valueAt(this.editStart, edit);
      if (start < cursor) throw new Error('Cell patch edits overlap');
      result.set(source.subarray(cursor, start), written);
      written += start - cursor;
      result.set(piece, written);
      written += piece.length;
      cursor = valueAt(this.editEnd, edit);
      edit += 1;
    }
    result.set(source.subarray(cursor), written);
    return result;
  }
}

/** max(floor(n * PATCH_GROWTH_NUMERATOR / PATCH_GROWTH_DENOMINATOR), n + PATCH_GROWTH_FLOOR_BYTES) */
export function patchedPartCap(sourceBytes: number): number {
  return Math.max(
    Math.floor((sourceBytes * PATCH_GROWTH_NUMERATOR) / PATCH_GROWTH_DENOMINATOR),
    sourceBytes + PATCH_GROWTH_FLOOR_BYTES,
  );
}

/**
 * `patches`: one output of a request, sorted by row then column, no cell twice, every value writable.
 * The walk checks all of that itself and throws Error('Invalid patch request: ...') otherwise.
 *
 * Throws SpreadsheetFileError, in this order: ROW_NOT_FOUND `{ count, rows }` for
 * patches on rows the part does not have; MALFORMED_SHEET `{ reason, count, rows }`
 * for a shared formula, then for a formula in a column outside
 * `overwriteFormulaColumns`; PAYLOAD_TOO_LARGE `{ reason: 'patch-growth', cap }` when
 * the result would exceed `maxBytes`. The one exception to the order: once the bytes
 * added alone exceed `maxBytes`, PAYLOAD_TOO_LARGE is thrown during the walk.
 */
export function applyCellPatches(
  index: SheetIndex,
  patches: readonly CellPatch[],
  options: WorksheetPatchOptions,
): WorksheetPatchResult {
  return new CellPatcher(index, patches, options).run();
}
