import type { Element } from '@xmldom/xmldom';
import { strFromU8, type Unzipped } from 'fflate';

import { MAX_WORKBOOK_RELS_BYTES } from './constants';
import { SpreadsheetFileError } from './errors';
import { attributeOf, childElements, corruptPart, localName, parsePart } from './xml-dom';

// Which zip entries make up a workbook, by read-excel-file 9.2.0's rules
// (modules/xlsx/parseSpreadsheetContents.js and parseFilePaths.js): it reads
// `xl/_rels/workbook.xml.rels` and `xl/workbook.xml`, then the Target of every
// relationship whose Type is exactly the styles, sharedStrings or worksheet type. A
// Target is mapped by getFilePath: a leading `/` is dropped, otherwise `xl/` is
// prepended, with no other normalization. Relationships are the DIRECT `Relationship`
// children of the rels root, by local name.

const RELATIONSHIP = 'Relationship';
const RELATIONSHIP_ID_ATTRIBUTE = 'Id';
const RELATIONSHIP_TYPE_ATTRIBUTE = 'Type';
const RELATIONSHIP_TARGET_ATTRIBUTE = 'Target';
const OFFICE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STYLES_RELATIONSHIP_TYPE = `${OFFICE_RELATIONSHIPS}/styles`;
const SHARED_STRINGS_RELATIONSHIP_TYPE = `${OFFICE_RELATIONSHIPS}/sharedStrings`;
const WORKSHEET_RELATIONSHIP_TYPE = `${OFFICE_RELATIONSHIPS}/worksheet`;
// The relationship types whose Target the reader opens (parseFilePaths.js).
const READER_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set([
  STYLES_RELATIONSHIP_TYPE,
  SHARED_STRINGS_RELATIONSHIP_TYPE,
  WORKSHEET_RELATIONSHIP_TYPE,
]);
const WORKSHEET_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set([WORKSHEET_RELATIONSHIP_TYPE]);
// getFilePath: an absolute Target loses its leading '/', a relative one is under xl/.
const ABSOLUTE_TARGET_PREFIX = '/';
const RELATIVE_TARGET_BASE = 'xl/';
// The reader keys worksheets in a plain object, where assigning a string to
// `__proto__` is a no-op: a worksheet relationship with this Id is never found.
const UNREACHABLE_WORKSHEET_ID = '__proto__';

/** The two parts the reader always opens, by these exact names. */
export const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
export const WORKBOOK_PART = 'xl/workbook.xml';
/** The package's content types part; the gate requires it, the reader never opens it. */
export const CONTENT_TYPES_PART = '[Content_Types].xml';
/** The package's root relationships part; the gate checks that it names the workbook part. */
export const ROOT_RELS_PART = '_rels/.rels';
// Entry names of active parts, ASCII-folded: a macro project, and anything under the
// external link and embedded object folders. A second line behind the content and
// relationship types (unsafe-parts.ts): Excel finds a part by its relationship, not by
// its name.
export const UNSAFE_PART_NAMES: readonly string[] = ['xl/vbaproject.bin'];
export const UNSAFE_PART_PREFIXES: readonly string[] = ['xl/externallinks/', 'xl/embeddings/'];

/** What the workbook rels tell the reader. */
export interface WorkbookRelationships {
  /** Worksheet part by relationship Id; a missing Id is the key 'null'. */
  readonly worksheetPathById: ReadonlyMap<string, string>;
  /** The last sharedStrings relationship's part, or null. */
  readonly sharedStringsPath: string | null;
  /** The last styles relationship's part, or null. */
  readonly stylesPath: string | null;
}

/** The zip entry name read-excel-file's getFilePath maps a relationship Target to. */
export function readerFilePath(target: string): string {
  return target.startsWith(ABSOLUTE_TARGET_PREFIX)
    ? target.slice(ABSOLUTE_TARGET_PREFIX.length)
    : `${RELATIVE_TARGET_BASE}${target}`;
}

function relationshipTarget(relationship: Element): string {
  const target = relationship.getAttribute(RELATIONSHIP_TARGET_ATTRIBUTE);
  if (target === null) {
    throw corruptPart(WORKBOOK_RELS_PART, 'Workbook relationship has no Target');
  }
  return target;
}

/**
 * Entry names the workbook rels map the relationships of the given `types` to, in
 * document order (repeats included), resolved exactly as read-excel-file does:
 * direct `Relationship` children of the root (by local name) whose `Type` is one
 * of `types`, their `Target` mapped by getFilePath. The rels part is parsed
 * strictly. CORRUPT_FILE when it does not parse, has no root, or a matching
 * relationship has no `Target` (the reader would throw on it).
 */
function relationshipPartPaths(relsXml: string, types: ReadonlySet<string>): string[] {
  const root = parsePart(WORKBOOK_RELS_PART, relsXml).documentElement;
  if (root === null) throw corruptPart(WORKBOOK_RELS_PART, 'Workbook part has no root element');
  const paths: string[] = [];
  for (const relationship of childElements(root)) {
    if (localName(relationship.tagName) !== RELATIONSHIP) continue;
    const type = relationship.getAttribute(RELATIONSHIP_TYPE_ATTRIBUTE);
    if (type === null || !types.has(type)) continue;
    paths.push(readerFilePath(relationshipTarget(relationship)));
  }
  return paths;
}

/**
 * Entry names of the styles, shared strings and worksheet parts the workbook rels
 * name, in document order (repeats included); see relationshipPartPaths.
 */
export function readerPartPaths(relsXml: string): string[] {
  return relationshipPartPaths(relsXml, READER_RELATIONSHIP_TYPES);
}

/**
 * The workbook rels part within MAX_WORKBOOK_RELS_BYTES, else PAYLOAD_TOO_LARGE. The
 * export resolves worksheet parts from it on the API's main thread, outside the parse
 * worker, so the gate (at import) and resolveWorksheetPartPaths (at export) both
 * refuse an oversized one before anything parses it.
 */
export function assertWorkbookRelsWithinCap(rels: Uint8Array): void {
  if (rels.length <= MAX_WORKBOOK_RELS_BYTES) return;
  throw new SpreadsheetFileError(
    'PAYLOAD_TOO_LARGE',
    `Workbook rels part exceeds ${MAX_WORKBOOK_RELS_BYTES}B`,
    { entry: WORKBOOK_RELS_PART, cap: MAX_WORKBOOK_RELS_BYTES },
  );
}

/**
 * Entry names of the worksheet parts the workbook rels of `entries` name, each
 * once, in document order, resolved the way the reader resolves them (see
 * relationshipPartPaths). These are exactly the worksheets the upload gate parsed
 * and bounded; any other entry under `xl/worksheets/` was never checked. Throws
 * SpreadsheetFileError CORRUPT_FILE when the workbook rels part is missing or does
 * not parse; an archive that passed the gate always has well-formed rels. The export
 * calls this on the API's main thread, outside the parse worker, so a rels part over
 * MAX_WORKBOOK_RELS_BYTES is refused (PAYLOAD_TOO_LARGE) before it is parsed; the
 * gate refuses the same part at import.
 */
export function resolveWorksheetPartPaths(entries: Unzipped): readonly string[] {
  const rels = entries[WORKBOOK_RELS_PART];
  if (rels === undefined) throw corruptPart(WORKBOOK_RELS_PART, 'Workbook rels part is missing');
  assertWorkbookRelsWithinCap(rels);
  return [...new Set(relationshipPartPaths(strFromU8(rels), WORKSHEET_RELATIONSHIP_TYPES))];
}

/**
 * The relationships the reader uses, from the root of the workbook rels part
 * (parseFilePaths.js): direct `Relationship` children whose `Type` matches exactly.
 * Worksheets are keyed by their `Id` as a string (a missing one is 'null', as in the
 * reader's object) and a later duplicate overwrites; the last styles and the last
 * sharedStrings relationship win. CORRUPT_FILE for a matching relationship without
 * a Target (the gate rejects such rels first).
 */
export function extractRelationships(root: Element): WorkbookRelationships {
  const worksheetPathById = new Map<string, string>();
  let sharedStringsPath: string | null = null;
  let stylesPath: string | null = null;
  for (const relationship of childElements(root)) {
    if (localName(relationship.tagName) !== RELATIONSHIP) continue;
    const type = relationship.getAttribute(RELATIONSHIP_TYPE_ATTRIBUTE);
    switch (type) {
      case STYLES_RELATIONSHIP_TYPE:
        stylesPath = readerFilePath(relationshipTarget(relationship));
        break;
      case SHARED_STRINGS_RELATIONSHIP_TYPE:
        sharedStringsPath = readerFilePath(relationshipTarget(relationship));
        break;
      case WORKSHEET_RELATIONSHIP_TYPE: {
        const path = readerFilePath(relationshipTarget(relationship));
        const id = String(attributeOf(relationship, RELATIONSHIP_ID_ATTRIBUTE));
        if (id !== UNREACHABLE_WORKSHEET_ID) worksheetPathById.set(id, path);
        break;
      }
      default:
        break;
    }
  }
  return { worksheetPathById, sharedStringsPath, stylesPath };
}
