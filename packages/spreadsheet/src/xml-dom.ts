import { DOMParser, Node, type Document, type Element } from '@xmldom/xmldom';

import { MAX_ERROR_CAUSE_LENGTH } from './constants';
import { SpreadsheetFileError } from './errors';

// DOM helpers shared by the upload gate and the grid reader. Elements are found the
// way read-excel-file 9.2.0 finds them (modules/xml/dom.js): by local name, among
// DIRECT children only, first match. Attributes are read by exact qualified name.
//
// Strings read from the DOM go through `wellFormed`: a `&#xD800;` reference leaves a
// lone surrogate in the DOM, while the old reader, which re-read every part after a
// UTF-8 round trip, saw U+FFFD in its place.

export const XML_MIME_TYPE = 'text/xml';

const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;
const REPLACEMENT_CHARACTER = '\uFFFD';
// Cheap pre-check: a string without any surrogate code unit is already well formed.
const ANY_SURROGATE = /[\uD800-\uDFFF]/;

/**
 * Local name of an element by read-excel-file's rule: `getTagName` in
 * read-excel-file/modules/xml/dom.js is `element.tagName.replace(/.+\:/, '')`.
 * Same result for every tag name xmldom accepts (a QName: no line break, a colon
 * never first), computed without that regex, which backtracks quadratically on a
 * long name without a colon.
 */
export function localName(tagName: string): string {
  const colon = tagName.lastIndexOf(':');
  return colon > 0 ? tagName.slice(colon + 1) : tagName;
}

export function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

export function childElements(parent: Node): Element[] {
  const out: Element[] = [];
  for (const child of parent.childNodes) {
    if (isElement(child)) out.push(child);
  }
  return out;
}

/** The first direct child element of `parent` whose local name is `name`, or null. */
export function firstChildNamed(parent: Node, name: string): Element | null {
  for (const child of parent.childNodes) {
    if (isElement(child) && localName(child.tagName) === name) return child;
  }
  return null;
}

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_FIRST && code <= HIGH_SURROGATE_LAST;
}

function isLowSurrogate(code: number): boolean {
  return code >= LOW_SURROGATE_FIRST && code <= LOW_SURROGATE_LAST;
}

/**
 * `text` with every unpaired surrogate replaced by U+FFFD, in one linear pass; a
 * valid surrogate pair is kept. Same result as `String.prototype.toWellFormed`,
 * which the ES2022 lib the API typechecks this source with does not declare.
 */
export function wellFormed(text: string): string {
  if (!ANY_SURROGATE.test(text)) return text;
  let out = '';
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(index + 1))) {
      index += 2;
      continue;
    }
    if (isHighSurrogate(code) || isLowSurrogate(code)) {
      out += text.slice(start, index) + REPLACEMENT_CHARACTER;
      start = index + 1;
    }
    index += 1;
  }
  return out + text.slice(start);
}

/** The attribute named exactly `name` (qualified name, no namespace lookup), or null. */
export function attributeOf(element: Element, name: string): string | null {
  const value = element.getAttribute(name);
  return value === null ? null : wellFormed(value);
}

/**
 * The `textContent` the old reader saw, with each text and CDATA node made
 * well-formed on its own. Like xmldom's `textContent`, it walks elements in
 * document order and skips comments and processing instructions. The old reader
 * parsed the SERIALIZED part, where a comment, processing instruction or child
 * element between two text nodes kept the halves of a split surrogate pair apart,
 * so each half became U+FFFD; joining the text first would pair them instead.
 * Iterative, so deep nesting cannot overflow the stack.
 */
export function textOf(node: Node): string {
  const parts: string[] = [];
  const pending: Node[] = [node];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    const type = current.nodeType;
    if (type === Node.ELEMENT_NODE || type === Node.DOCUMENT_FRAGMENT_NODE) {
      const children = [...current.childNodes];
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        if (child !== undefined) pending.push(child);
      }
      continue;
    }
    if (type === Node.COMMENT_NODE || type === Node.PROCESSING_INSTRUCTION_NODE) continue;
    parts.push(wellFormed(current.nodeValue ?? ''));
  }
  return parts.join('');
}

export function corruptPart(entry: string, message: string, cause?: unknown): SpreadsheetFileError {
  const meta =
    cause === undefined
      ? { entry }
      : { entry, cause: String(cause).slice(0, MAX_ERROR_CAUSE_LENGTH) };
  return new SpreadsheetFileError('CORRUPT_FILE', message, meta);
}

// Anything above a warning stops the parse: xmldom wraps the throw in a ParseError.
function stopOnError(level: 'warning' | 'error' | 'fatalError', message: string): void {
  if (level !== 'warning') throw new Error(message);
}

/** Parses `xml` strictly; anything above a warning is CORRUPT_FILE for `entry`. */
export function parsePart(entry: string, xml: string): Document {
  try {
    return new DOMParser({ onError: stopOnError }).parseFromString(xml, XML_MIME_TYPE);
  } catch (e) {
    throw corruptPart(entry, 'Workbook part is not well-formed XML', e);
  }
}
