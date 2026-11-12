import type { Element } from '@xmldom/xmldom';
import { strFromU8 } from 'fflate';

import { extractSharedStrings, extractWorkbook, extractXfIsDate, type SheetEntry } from './book';
import { cellValue, ReaderRuleError, type CellContext } from './cell-value';
import { MAX_ERROR_CAUSE_LENGTH, MAX_GRID_TEXT_LENGTH } from './constants';
import { SpreadsheetFileError } from './errors';
import type { CellValue, SheetData } from './grid-types';
import { openUpload, type UploadParts } from './guards';
import { checkPart, type CellVisitor, type GridCaps } from './part-checks';
import type { ResolvedReadOptions } from './read-options';
import {
  extractRelationships,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
  type WorkbookRelationships,
} from './workbook-parts';
import { corruptPart, firstChildNamed, parsePart } from './xml-dom';

// The grid reader: builds a worksheet's grid straight from the gate's DOM, by the
// exact rules of the 9.2.0 reader library it replaced (reader contract). Every part
// is parsed once, strictly, and dropped before the next one, so one DOM is alive at a
// time:
//   1. the order is the book parts (the workbook rels, the workbook, then the last
//      sharedStrings and the last styles part the rels name, each once), then every
//      other part in the order the gate picked it;
//   2. each part goes through the gate's checkPart; a book part also yields what the
//      reader needs from it (relationships, sheet list, trimmed shared strings, which
//      styles format dates);
//   3. the selected worksheet's cells are converted while checkPart walks them
//      (cell-value.ts); a worksheet that is also a book part (crafted rels) is
//      parsed again and converted after the walk.
// Gate errors win over reader errors: a rule the reader would break (ReaderRuleError)
// is held until every part has passed checkPart. A named sheet that cannot be read
// falls back to the first sheet, as the old pipeline's wrapper did; a sheet that
// still cannot be read is CORRUPT_FILE.

const SHEET_DATA = 'sheetData';
const READ_FAILED_MESSAGE = 'Cannot read workbook';

/** Called with each part's root before its checks; returns the visitor for its cells. */
type PartHandler = (
  path: string,
  root: Element,
  relationships: WorkbookRelationships,
) => CellVisitor | undefined;

/** A worksheet being converted: the values placed so far, and the first rule it broke. */
interface Conversion {
  /** Values by 0-based row, then column; a hole is a cell that was never placed. */
  readonly placed: (CellValue[] | undefined)[];
  failure: ReaderRuleError | null;
}

interface WorkbookInfo {
  readonly sheets: readonly SheetEntry[];
  readonly epoch1904: boolean;
}

/** What readGrid's scan learns from the book parts, and the conversion it starts. */
interface ScanState {
  /** The first reader rule a book part broke. */
  held: ReaderRuleError | null;
  workbook: WorkbookInfo | null;
  sharedStrings: readonly (string | null)[] | null;
  xfIsDate: readonly boolean[] | null;
  /** The part the selected sheet reads from, set with the workbook; null when none. */
  targetPath: string | null;
  /** The selected worksheet, when the scan converted it. */
  conversion: Conversion | null;
}

/** The sheet to read, and whether its failure falls back to the first sheet. */
interface SheetChoice {
  readonly sheet: SheetEntry | undefined;
  readonly fallback: boolean;
}

function partRoot(parts: UploadParts, path: string): Element {
  const bytes = Object.hasOwn(parts, path) ? parts[path] : undefined;
  if (bytes === undefined) throw corruptPart(path, 'Workbook part the reader opens is missing');
  const root = parsePart(path, strFromU8(bytes)).documentElement;
  if (root === null) throw corruptPart(path, 'Workbook part has no root element');
  return root;
}

function bookPathsOf(relationships: WorkbookRelationships): string[] {
  const paths = [WORKBOOK_RELS_PART, WORKBOOK_PART];
  for (const path of [relationships.sharedStringsPath, relationships.stylesPath]) {
    if (path !== null && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

function scanRelsPart(
  parts: UploadParts,
  caps: GridCaps,
  handle: PartHandler,
): WorkbookRelationships {
  const root = partRoot(parts, WORKBOOK_RELS_PART);
  // Gate first, then extraction: a part's caps and limits hold before any reader
  // work on it runs (an over-long format code must not be classified first).
  checkPart(WORKBOOK_RELS_PART, root, caps);
  const relationships = extractRelationships(root);
  handle(WORKBOOK_RELS_PART, root, relationships);
  return relationships;
}

/** Parses and checks every part in reader order (see the header), one DOM at a time. */
function scanParts(parts: UploadParts, caps: GridCaps, handle: PartHandler): WorkbookRelationships {
  const relationships = scanRelsPart(parts, caps, handle);
  const bookPaths = bookPathsOf(relationships);
  const otherPaths = Object.keys(parts).filter((path) => !bookPaths.includes(path));
  for (const path of bookPaths.slice(1)) {
    const root = partRoot(parts, path);
    // Book parts are never converted as the target sheet during the scan (see
    // readGrid), so they get no visitor: gate first, then extraction.
    checkPart(path, root, caps);
    handle(path, root, relationships);
  }
  for (const path of otherPaths) {
    const root = partRoot(parts, path);
    checkPart(path, root, caps, handle(path, root, relationships));
  }
  return relationships;
}

function holdReaderError(state: ScanState, extract: () => void): void {
  try {
    extract();
  } catch (e) {
    if (!(e instanceof ReaderRuleError)) throw e;
    state.held ??= e;
  }
}

function readBookPart(
  state: ScanState,
  path: string,
  root: Element,
  relationships: WorkbookRelationships,
  sheetName: string | undefined,
): void {
  if (path === WORKBOOK_PART) {
    holdReaderError(state, () => {
      const workbook = extractWorkbook(root);
      state.workbook = workbook;
      state.targetPath = worksheetPath(
        relationships,
        chooseSheet(workbook.sheets, sheetName).sheet,
      );
    });
  }
  if (path === relationships.sharedStringsPath) {
    holdReaderError(state, () => {
      state.sharedStrings = extractSharedStrings(root);
    });
  }
  if (path === relationships.stylesPath) {
    holdReaderError(state, () => {
      state.xfIsDate = extractXfIsDate(root);
    });
  }
}

/**
 * The first sheet named `sheetName`, else the first sheet. Only a named sheet after
 * the first falls back: an unknown name already reads the first sheet.
 */
function chooseSheet(sheets: readonly SheetEntry[], sheetName: string | undefined): SheetChoice {
  const index = sheetName === undefined ? -1 : sheets.findIndex((s) => s.name === sheetName);
  if (index < 0) return { sheet: sheets[0], fallback: false };
  return { sheet: sheets[index], fallback: index > 0 };
}

/** The worksheet part `sheet` reads from, or null when its relation is not a worksheet. */
function worksheetPath(
  relationships: WorkbookRelationships,
  sheet: SheetEntry | undefined,
): string | null {
  if (sheet === undefined || sheet.relationId === null) return null;
  return relationships.worksheetPathById.get(sheet.relationId) ?? null;
}

function isBookPath(relationships: WorkbookRelationships, path: string): boolean {
  return (
    path === WORKBOOK_RELS_PART ||
    path === WORKBOOK_PART ||
    path === relationships.sharedStringsPath ||
    path === relationships.stylesPath
  );
}

function cellContext(state: ScanState, workbook: WorkbookInfo): CellContext {
  return {
    sharedStrings: state.sharedStrings ?? [],
    xfIsDate: state.xfIsDate ?? [],
    epoch1904: workbook.epoch1904,
  };
}

/** A conversion of the worksheet under `root`; a root without `sheetData` breaks the reader. */
function startConversion(root: Element): Conversion {
  const failure =
    firstChildNamed(root, SHEET_DATA) === null
      ? new ReaderRuleError('Worksheet has no sheetData')
      : null;
  return { placed: [], failure };
}

/** Places each checked cell's value; after the first broken rule, values are not computed. */
function collectCells(conversion: Conversion, context: CellContext): CellVisitor {
  return (cell, _row, position) => {
    if (conversion.failure !== null) return;
    let value: CellValue;
    try {
      value = cellValue(cell, context);
    } catch (e) {
      if (!(e instanceof ReaderRuleError)) throw e;
      conversion.failure = e;
      return;
    }
    const line = (conversion.placed[position.row - 1] ??= []);
    line[position.col - 1] = value;
  };
}

/** Parses the part `sheet` reads from again and converts it (it already passed checkPart). */
function convertSheet(
  parts: UploadParts,
  caps: GridCaps,
  relationships: WorkbookRelationships,
  sheet: SheetEntry | undefined,
  context: CellContext,
): Conversion {
  const path = worksheetPath(relationships, sheet);
  if (path === null) {
    return { placed: [], failure: new ReaderRuleError('Sheet is not a worksheet') };
  }
  const root = partRoot(parts, path);
  const conversion = startConversion(root);
  checkPart(path, root, caps, collectCells(conversion, context));
  return conversion;
}

/**
 * The grid of the placed values, by the reader's rules: rows and columns start at 1,
 * so leading empty rows and columns are kept; empty cells are null; trailing
 * all-null columns, then trailing all-null rows are dropped; nothing left is [].
 */
function assembleGrid(placed: readonly (readonly CellValue[] | undefined)[]): SheetData {
  let height = 0;
  let width = 0;
  for (let r = 0; r < placed.length; r += 1) {
    const line = placed[r];
    if (line === undefined) continue;
    for (let c = 0; c < line.length; c += 1) {
      const value = line[c];
      if (value === undefined || value === null) continue;
      height = r + 1;
      width = Math.max(width, c + 1);
    }
  }
  const grid: SheetData = [];
  for (let r = 0; r < height; r += 1) {
    const line = placed[r];
    const cells: CellValue[] = [];
    for (let c = 0; c < width; c += 1) cells.push(line?.[c] ?? null);
    grid.push(cells);
  }
  return grid;
}

function cannotRead(cause: ReaderRuleError): SpreadsheetFileError {
  return new SpreadsheetFileError('CORRUPT_FILE', READ_FAILED_MESSAGE, {
    cause: String(cause).slice(0, MAX_ERROR_CAUSE_LENGTH),
  });
}

/** The body of readGrid; see readGrid. */
function readGridParts(
  parts: UploadParts,
  options: { readonly sheetName?: string; readonly caps: GridCaps },
): SheetData {
  const { sheetName, caps } = options;
  const state: ScanState = {
    held: null,
    workbook: null,
    sharedStrings: null,
    xfIsDate: null,
    targetPath: null,
    conversion: null,
  };

  const relationships = scanParts(parts, caps, (path, root, rels) => {
    readBookPart(state, path, root, rels, sheetName);
    const workbook = state.workbook;
    // Every book part is scanned before any other part, so `held` and the workbook are
    // final here. A worksheet that is also a book part is converted after the scan.
    if (state.held !== null || workbook === null) return undefined;
    if (path !== state.targetPath || isBookPath(rels, path)) return undefined;
    const conversion = startConversion(root);
    state.conversion = conversion;
    if (conversion.failure !== null) return undefined;
    return collectCells(conversion, cellContext(state, workbook));
  });

  if (state.held !== null) throw cannotRead(state.held);
  const workbook = state.workbook;
  if (workbook === null) throw cannotRead(new ReaderRuleError('Workbook part was not read'));
  const context = cellContext(state, workbook);
  const choice = chooseSheet(workbook.sheets, sheetName);
  let conversion =
    state.conversion ?? convertSheet(parts, caps, relationships, choice.sheet, context);
  if (conversion.failure !== null && choice.fallback) {
    conversion = convertSheet(parts, caps, relationships, workbook.sheets[0], context);
  }
  if (conversion.failure !== null) throw cannotRead(conversion.failure);
  return assembleGrid(conversion.placed);
}

/**
 * The grid of the sheet named `sheetName` (else the first sheet) of the reader parts
 * `parts` (see the header). Throws SpreadsheetFileError: every gate error checkPart
 * raises, before any reader error; CORRUPT_FILE when the workbook cannot be read.
 */
export function readGrid(
  parts: UploadParts,
  options: { readonly sheetName?: string; readonly caps: GridCaps },
): SheetData {
  try {
    return readGridParts(parts, options);
  } catch (e) {
    if (e instanceof SpreadsheetFileError) throw e;
    // The old pipeline turned any failure of its reader into CORRUPT_FILE. An
    // exception nothing here anticipated (a TypeError, a RangeError from deep nesting)
    // means this file cannot be read; it must not surface as a 500.
    throw new SpreadsheetFileError('CORRUPT_FILE', READ_FAILED_MESSAGE, {
      cause: String(e).slice(0, MAX_ERROR_CAUSE_LENGTH),
    });
  }
}

/**
 * The gate's DOM checks on every reader part, without building a grid: each part is
 * parsed strictly and goes through checkPart, in the order readGrid uses. Reader
 * rules (a workbook without sheets, a bad cell value) are not checked.
 */
export function checkUploadParts(parts: UploadParts, caps: GridCaps): void {
  scanParts(parts, caps, () => undefined);
}

/**
 * Throws SpreadsheetFileError PAYLOAD_TOO_LARGE `{ cap }` when the string cells of
 * `grid` hold more than MAX_GRID_TEXT_LENGTH UTF-16 code units together. The grid is
 * copied out of the parse worker, and the copy does not share repeated strings.
 */
export function assertGridTextWithinCap(grid: SheetData): void {
  let total = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (typeof cell !== 'string') continue;
      total += cell.length;
      if (total <= MAX_GRID_TEXT_LENGTH) continue;
      throw new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Workbook grid holds too much text', {
        cap: MAX_GRID_TEXT_LENGTH,
      });
    }
  }
}

/**
 * The grid of an upload: the gate (openUpload: size, magic bytes, streaming caps,
 * structure, central directory, part budgets and content scan), then readGrid on the
 * parts it returns, then the grid text cap. `options` are already resolved
 * (resolveReadOptions). Throws SpreadsheetFileError on any violation or when the
 * workbook cannot be read.
 */
export function readUploadGrid(file: Uint8Array, options: ResolvedReadOptions): SheetData {
  const { sheetName, rowCap, colCap, maxBytes } = options;
  const grid = readGrid(openUpload(file, { rowCap, colCap, maxBytes }), {
    sheetName,
    caps: { rowCap, colCap },
  });
  assertGridTextWithinCap(grid);
  return grid;
}
