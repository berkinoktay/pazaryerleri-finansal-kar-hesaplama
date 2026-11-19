import type { Element, Node } from '@xmldom/xmldom';
import { strFromU8 } from 'fflate';

import { extractSharedStrings, extractWorkbook, extractXfIsDate, type SheetEntry } from './book';
import { cellValue, ReaderRuleError, type CellContext } from './cell-value';
import { MAX_ERROR_CAUSE_LENGTH, MAX_GRID_TEXT_LENGTH } from './constants';
import { SpreadsheetFileError } from './errors';
import type { CellValue, SheetData } from './grid-types';
import { openUpload, openUploadWithLayout, type UploadParts } from './guards';
import { createPackageCensusCollector, type PackageCensus } from './package-census';
import { checkPart, type CellVisitor, type GridCaps } from './part-checks';
import type { ResolvedReadOptions, SheetSelector } from './read-options';
import { cellKey } from './sheet-meta';
import {
  extractRelationships,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
  type WorkbookRelationships,
} from './workbook-parts';
import {
  childElements,
  corruptPart,
  firstChildNamed,
  isElement,
  localName,
  parsePart,
} from './xml-dom';

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
// A converted worksheet whose `sheetData` holds an `AlternateContent` element (any
// namespace) anywhere below it, inside a row or a cell included, breaks a reader rule:
// the reader and the patcher's index skip it, Excel may apply one of its branches.
// Gate errors win over reader errors: a rule the reader would break (ReaderRuleError)
// is held until every part has passed checkPart. A named sheet that cannot be read
// falls back to the first sheet, as the old pipeline's wrapper did; a sheet that
// still cannot be read is CORRUPT_FILE. A strict selector (`sheet`) never falls back:
// a sheet it does not find is SHEET_NOT_FOUND, raised only after every part has passed
// checkPart and no reader rule is held; a selected sheet that cannot be read is
// CORRUPT_FILE.
// readSheet (the export patch path) also reports which part the grid came from, the
// position of every cell it placed, the worksheet's merged ranges (the union of every
// `mergeCells` block a sheet holds, directly or inside `AlternateContent`, so no block
// can hide a range) and the range of every array or data table formula of a placed
// cell. Collecting them never throws, so it cannot change which sheet is read.
// readGrid does not track them: its work, allocations and errors are those of the
// grid alone.

const SHEET_DATA = 'sheetData';
const MERGE_CELLS = 'mergeCells';
const MERGE_CELL = 'mergeCell';
// Markup compatibility's wrapper (`mc:AlternateContent`): Excel applies one of its branches.
const ALTERNATE_CONTENT = 'AlternateContent';
const REF_ATTRIBUTE = 'ref';
const MISSING_REF = '';
const FORMULA = 'f';
const FORMULA_TYPE_ATTRIBUTE = 't';
// Formula types whose `ref` spans cells that hold no `f` of their own. A shared
// formula's other cells each carry an `f`, which the patcher sees.
const RANGE_FORMULA_TYPES: ReadonlySet<string> = new Set(['array', 'dataTable']);
// The part of a conversion whose sheet is not a worksheet: it has failed, so its part
// is never reported.
const NO_PART = '';
// What an untracked conversion records: nothing.
const NOT_TRACKED: readonly never[] = [];
const READ_FAILED_MESSAGE = 'Cannot read workbook';
const SHEET_NOT_FOUND_MESSAGE = 'Selected sheet not found';

/** A sheet as readSheet reads it: the grid, and what the export patch path checks it against. */
export interface SheetReading {
  readonly grid: SheetData;
  /** The worksheet part the grid was converted from (the first sheet's when the legacy fallback applied). */
  readonly partPath: string;
  /** That part is also the rels, the workbook, the shared strings or the styles part (crafted rels). */
  readonly partIsBookPart: boolean;
  /** `cellKey(row, column)` of every cell the reader placed, in document order. */
  readonly cellKeys: readonly number[];
  /**
   * The raw `ref` ('' when absent) of every `mergeCell` under every direct `mergeCells`
   * child of the part's root and under every `mergeCells` inside a direct
   * `AlternateContent` child, any namespace, in document order.
   */
  readonly mergeRefs: readonly string[];
  /**
   * The raw `ref` ('' when absent) of every `f` (any namespace) that is a direct child
   * of a placed cell and whose `t` is "array" or "dataTable", in document order.
   */
  readonly formulaRangeRefs: readonly string[];
  /**
   * Per `cellXfs` entry, whether the style formats a date: the table the reader read
   * the cells with (empty without a styles part).
   */
  readonly xfIsDate: readonly boolean[];
  /** The styles part the date table came from (the last styles relationship's), or null. */
  readonly stylesPath: string | null;
  /**
   * That part is also the rels, the workbook, the shared strings or the converted
   * worksheet part (crafted rels); false without a styles part.
   */
  readonly stylesPartIsShared: boolean;
}

/** Which sheet readGrid reads: strictly by `sheet`, else by `sheetName` (see chooseSheet). */
interface SheetRequest {
  readonly sheetName?: string;
  readonly sheet?: SheetSelector;
}

/** readGrid's options: the sheet to read and the gate's caps. */
interface GridReadOptions extends SheetRequest {
  readonly caps: GridCaps;
}

/** Called with each part's root before its checks; returns the visitor for its cells. */
type PartHandler = (
  path: string,
  root: Element,
  relationships: WorkbookRelationships,
) => CellVisitor | undefined;

/**
 * A worksheet being converted: its part, the values placed so far, and the first rule
 * it broke; when tracked, also the key of every placed cell, its merge refs and the
 * formula range refs of its placed cells.
 */
interface Conversion {
  readonly partPath: string;
  /** Values by 0-based row, then column; a hole is a cell that was never placed. */
  readonly placed: (CellValue[] | undefined)[];
  failure: ReaderRuleError | null;
  /** Null when the conversion is not tracked. */
  readonly cellKeys: number[] | null;
  readonly mergeRefs: readonly string[];
  /** Null when the conversion is not tracked. */
  readonly formulaRangeRefs: string[] | null;
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

/**
 * The sheet to read, whether its failure falls back to the first sheet, and, when a
 * strict selector matches no sheet, the selector's kind (else null).
 */
interface SheetChoice {
  readonly sheet: SheetEntry | undefined;
  readonly fallback: boolean;
  readonly missing: SheetSelector['by'] | null;
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
  request: SheetRequest,
): void {
  if (path === WORKBOOK_PART) {
    holdReaderError(state, () => {
      const workbook = extractWorkbook(root);
      state.workbook = workbook;
      // A missing strict sheet has no target: nothing is converted during the scan.
      state.targetPath = worksheetPath(relationships, chooseSheet(workbook.sheets, request).sheet);
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
 * With a strict `sheet` selector, the sheet it selects, never a fallback; a selector
 * that matches no sheet is `missing`, except in an empty sheet list, which reads as
 * CORRUPT_FILE as before. Otherwise the first sheet named `sheetName`, else the first
 * sheet. Only a named sheet after the first falls back: an unknown name already reads
 * the first sheet.
 */
function chooseSheet(sheets: readonly SheetEntry[], request: SheetRequest): SheetChoice {
  const { sheet: selector, sheetName } = request;
  if (selector !== undefined) {
    const sheet = selectSheet(sheets, selector);
    const missing = sheet === undefined && sheets.length > 0 ? selector.by : null;
    return { sheet, fallback: false, missing };
  }
  const index = sheetName === undefined ? -1 : sheets.findIndex((s) => s.name === sheetName);
  if (index < 0) return { sheet: sheets[0], fallback: false, missing: null };
  return { sheet: sheets[index], fallback: index > 0, missing: null };
}

/** The first sheet named exactly as `selector` says, or the sheet at its index. */
function selectSheet(
  sheets: readonly SheetEntry[],
  selector: SheetSelector,
): SheetEntry | undefined {
  switch (selector.by) {
    case 'name':
      return sheets.find((s) => s.name === selector.name);
    case 'index':
      return sheets[selector.index];
    default: {
      const _exhaustive: never = selector;
      throw new Error(`Unhandled sheet selector: ${String(_exhaustive)}`);
    }
  }
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

/** Whether the styles part is also another part the reader reads: the rels, the workbook, the shared strings or `partPath`. */
function isSharedStylesPart(relationships: WorkbookRelationships, partPath: string): boolean {
  const { stylesPath } = relationships;
  if (stylesPath === null) return false;
  return (
    stylesPath === WORKBOOK_RELS_PART ||
    stylesPath === WORKBOOK_PART ||
    stylesPath === relationships.sharedStringsPath ||
    stylesPath === partPath
  );
}

function cellContext(state: ScanState, workbook: WorkbookInfo): CellContext {
  return {
    sharedStrings: state.sharedStrings ?? [],
    xfIsDate: state.xfIsDate ?? [],
    epoch1904: workbook.epoch1904,
  };
}

/**
 * Appends to `refs`, in document order, the raw `ref` of every `mergeCell` element
 * inside a `mergeCells` element of the subtree of `top` (`top` included), each once;
 * names by local name, any namespace. Iterative, so deep nesting cannot overflow the
 * stack, and it never throws.
 */
function collectMergeRefs(top: Element, refs: string[]): void {
  // Parallel stacks: an element still to visit, and whether a `mergeCells` encloses it.
  const pending: Element[] = [top];
  const enclosed: boolean[] = [false];
  for (let element = pending.pop(); element !== undefined; element = pending.pop()) {
    const inMergeCells = enclosed.pop() ?? false;
    const name = localName(element.tagName);
    if (inMergeCells && name === MERGE_CELL) {
      refs.push(element.getAttribute(REF_ATTRIBUTE) ?? MISSING_REF);
    }
    const childrenEnclosed = inMergeCells || name === MERGE_CELLS;
    const children = childElements(element);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child === undefined) continue;
      pending.push(child);
      enclosed.push(childrenEnclosed);
    }
  }
}

/**
 * The raw `ref` of every `mergeCell` that Excel could apply, in document order: those
 * under every direct `mergeCells` child of `root` and under every `mergeCells` inside a
 * direct `AlternateContent` child, whatever their namespaces. Taking the union, a
 * decoy block or a second block cannot hide a range from the merged-target check:
 * more targets are refused, none is missed.
 */
function mergeRefsOf(root: Element): string[] {
  const refs: string[] = [];
  for (const child of childElements(root)) {
    const name = localName(child.tagName);
    if (name === MERGE_CELLS || name === ALTERNATE_CONTENT) collectMergeRefs(child, refs);
  }
  return refs;
}

/**
 * Appends to `refs`, in document order, the raw `ref` ('' when absent) of every
 * direct child of `cell` whose local name is `f` and whose `t` is an array or data
 * table type, any namespace. No list of children is built, and it never throws.
 */
function collectFormulaRangeRefs(cell: Element, refs: string[]): void {
  for (const child of cell.childNodes) {
    if (!isElement(child) || localName(child.tagName) !== FORMULA) continue;
    const type = child.getAttribute(FORMULA_TYPE_ATTRIBUTE);
    if (type === null || !RANGE_FORMULA_TYPES.has(type)) continue;
    refs.push(child.getAttribute(REF_ATTRIBUTE) ?? MISSING_REF);
  }
}

/**
 * Whether `sheetData` holds an element whose local name is `AlternateContent`, any
 * namespace, anywhere below it (in a row, a cell or deeper). One pass over its
 * descendants in document order, iterative (deep nesting cannot overflow the stack) and
 * with no list built per element; it never throws.
 */
function holdsAlternateContent(sheetData: Element): boolean {
  let node: Node | null = sheetData.firstChild;
  while (node !== null && node !== sheetData) {
    if (isElement(node) && localName(node.tagName) === ALTERNATE_CONTENT) return true;
    node = nextInSubtree(node, sheetData);
  }
  return false;
}

/**
 * The node after `node` in document order within the subtree of `top`: its first child,
 * else the next sibling of it or of its nearest ancestor below `top` that has one; `top`
 * itself once the subtree is done.
 */
function nextInSubtree(node: Node, top: Node): Node {
  if (node.firstChild !== null) return node.firstChild;
  let current: Node = node;
  while (current !== top) {
    if (current.nextSibling !== null) return current.nextSibling;
    const parent = current.parentNode;
    if (parent === null) return top;
    current = parent;
  }
  return top;
}

/** The reader rule a worksheet root breaks before any cell is read, or null. */
function sheetDataFailure(root: Element): ReaderRuleError | null {
  const sheetData = firstChildNamed(root, SHEET_DATA);
  if (sheetData === null) return new ReaderRuleError('worksheetWithoutSheetData');
  if (holdsAlternateContent(sheetData)) {
    return new ReaderRuleError('alternateContentInSheetData');
  }
  return null;
}

/**
 * A conversion of the worksheet part `partPath` under `root`; a root without
 * `sheetData`, or with `AlternateContent` anywhere inside its sheet data, breaks the
 * reader. Only a tracked conversion reads the merge refs.
 */
function startConversion(partPath: string, root: Element, track: boolean): Conversion {
  const failure = sheetDataFailure(root);
  return {
    partPath,
    placed: [],
    failure,
    cellKeys: track ? [] : null,
    mergeRefs: track ? mergeRefsOf(root) : NOT_TRACKED,
    formulaRangeRefs: track ? [] : null,
  };
}

/**
 * Places each checked cell's value, and records its key and its formula range refs
 * when the conversion is tracked; after the first broken rule, values are not
 * computed.
 */
function collectCells(conversion: Conversion, context: CellContext): CellVisitor {
  const keys = conversion.cellKeys;
  const formulaRanges = conversion.formulaRangeRefs;
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
    if (keys !== null) keys.push(cellKey(position.row, position.col));
    if (formulaRanges !== null) collectFormulaRangeRefs(cell, formulaRanges);
  };
}

/** Parses the part `sheet` reads from again and converts it (it already passed checkPart). */
function convertSheet(
  parts: UploadParts,
  caps: GridCaps,
  relationships: WorkbookRelationships,
  sheet: SheetEntry | undefined,
  context: CellContext,
  track: boolean,
): Conversion {
  const path = worksheetPath(relationships, sheet);
  if (path === null) {
    return {
      partPath: NO_PART,
      placed: [],
      failure: new ReaderRuleError('sheetNotWorksheet'),
      cellKeys: null,
      mergeRefs: NOT_TRACKED,
      formulaRangeRefs: null,
    };
  }
  const root = partRoot(parts, path);
  const conversion = startConversion(path, root, track);
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
    rule: cause.rule,
  });
}

function sheetNotFound(by: SheetSelector['by']): SpreadsheetFileError {
  return new SpreadsheetFileError('SHEET_NOT_FOUND', SHEET_NOT_FOUND_MESSAGE, { by });
}

/**
 * The body of readGrid and readSheet; see readGrid. With `track`, the conversions
 * record their cell keys, merge refs and formula range refs; without it, the reading
 * carries none.
 */
function readGridParts(parts: UploadParts, options: GridReadOptions, track: boolean): SheetReading {
  const { caps } = options;
  const state: ScanState = {
    held: null,
    workbook: null,
    sharedStrings: null,
    xfIsDate: null,
    targetPath: null,
    conversion: null,
  };

  const relationships = scanParts(parts, caps, (path, root, rels) => {
    readBookPart(state, path, root, rels, options);
    const workbook = state.workbook;
    // Every book part is scanned before any other part, so `held` and the workbook are
    // final here. A worksheet that is also a book part is converted after the scan.
    if (state.held !== null || workbook === null) return undefined;
    if (path !== state.targetPath || isBookPath(rels, path)) return undefined;
    const conversion = startConversion(path, root, track);
    state.conversion = conversion;
    if (conversion.failure !== null) return undefined;
    return collectCells(conversion, cellContext(state, workbook));
  });

  if (state.held !== null) throw cannotRead(state.held);
  const workbook = state.workbook;
  if (workbook === null) throw cannotRead(new ReaderRuleError('workbookPartNotRead'));
  const choice = chooseSheet(workbook.sheets, options);
  // Only now: every part has passed checkPart and no reader rule is held.
  if (choice.missing !== null) throw sheetNotFound(choice.missing);
  const context = cellContext(state, workbook);
  let conversion =
    state.conversion ?? convertSheet(parts, caps, relationships, choice.sheet, context, track);
  if (conversion.failure !== null && choice.fallback) {
    conversion = convertSheet(parts, caps, relationships, workbook.sheets[0], context, track);
  }
  if (conversion.failure !== null) throw cannotRead(conversion.failure);
  return {
    grid: assembleGrid(conversion.placed),
    partPath: conversion.partPath,
    partIsBookPart: isBookPath(relationships, conversion.partPath),
    cellKeys: conversion.cellKeys ?? NOT_TRACKED,
    mergeRefs: conversion.mergeRefs,
    formulaRangeRefs: conversion.formulaRangeRefs ?? NOT_TRACKED,
    xfIsDate: context.xfIsDate,
    stylesPath: relationships.stylesPath,
    stylesPartIsShared: isSharedStylesPart(relationships, conversion.partPath),
  };
}

/** readGridParts, with an exception nothing here anticipated turned into CORRUPT_FILE. */
function readParts(parts: UploadParts, options: GridReadOptions, track: boolean): SheetReading {
  try {
    return readGridParts(parts, options, track);
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
 * The grid of the sheet `options` selects (strictly by `sheet`, else named `sheetName`
 * with the first-sheet fallback) of the reader parts `parts` (see the header). Throws
 * SpreadsheetFileError: every gate error checkPart raises, before any reader error;
 * CORRUPT_FILE when the workbook cannot be read; SHEET_NOT_FOUND `{ by }` when a strict
 * selector matches no sheet.
 */
export function readGrid(parts: UploadParts, options: GridReadOptions): SheetData {
  return readParts(parts, options, false).grid;
}

/**
 * readGrid's reading of the same sheet, with the same errors, plus the part it came
 * from, the key of every cell it placed, its merge refs, its formula range refs, its
 * date table and the styles part it came from (see SheetReading).
 */
export function readSheet(parts: UploadParts, options: GridReadOptions): SheetReading {
  return readParts(parts, options, true);
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
  const { sheetName, sheet, rowCap, colCap, maxBytes } = options;
  const grid = readGrid(openUpload(file, { rowCap, colCap, maxBytes }), {
    sheetName,
    sheet,
    caps: { rowCap, colCap },
  });
  assertGridTextWithinCap(grid);
  return grid;
}

/**
 * The package census of an upload (package-census.ts): the byte-level gate
 * (openUploadWithLayout: size, magic bytes, streaming caps, structure, central directory,
 * part budgets and content scan) runs whole with a census collector, which records the
 * content types and relationship types the gate reads; no reader part is parsed into a
 * DOM, so checkPart and the reader's rules do not run. `rowCap`, `colCap` and `maxBytes`
 * come from `options` (resolveReadOptions); the sheet selector is not used. A file the
 * gate refuses throws its SpreadsheetFileError and yields no census.
 */
export function readUploadCensus(file: Uint8Array, options: ResolvedReadOptions): PackageCensus {
  const { rowCap, colCap, maxBytes } = options;
  const census = createPackageCensusCollector();
  openUploadWithLayout(file, { rowCap, colCap, maxBytes }, census);
  return census.result();
}
