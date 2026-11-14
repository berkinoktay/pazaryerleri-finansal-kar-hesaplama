import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import { SpreadsheetFileError } from './errors';
import {
  assertEntryContentKind,
  assertSafeXmlContent,
  assertSafeXmlPart,
  createEntryContentSniff,
  feedEntryContentSniff,
  finishEntryContentSniff,
  isXmlPart,
  tooManyNamespaceDeclarations,
  type EntryContentKind,
} from './content-scan';
import { cutRootChildren, literalAttributeText } from './patch/calc-chain';
import { readZipLayout, type ZipLayout } from './patch/raw-zip';
import { ZIP_REJECT_REASONS } from './patch/reasons';
import { foldAsciiCase, metaEntryName } from './patch/shared';
import { localNameIs, type XmlMarkup } from './patch/xml-lexer';
import { assertSameViews } from './patch/zip-views';
import {
  assertNoUnsafePackageParts,
  assertNoUnsafePartNames,
  assertSafeRelationshipType,
  assertSafeTarget,
  type RelationshipsSourceKind,
} from './unsafe-parts';
import {
  assertWorkbookRelsWithinCap,
  CONTENT_TYPES_PART,
  readerPartPaths,
  ROOT_RELS_PART,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
} from './workbook-parts';
import {
  XLSX_MAGIC,
  MAX_ZIP_ENTRIES,
  MAX_DECOMPRESSED_BYTES,
  MAX_ERROR_CAUSE_LENGTH,
  MAX_WORKBOOK_RELS_BYTES,
  MAX_XMLNS_DECLARATIONS_PER_PART,
  MAX_XML_DOM_WEIGHT,
  MAX_XML_NAME_LENGTH,
  MAX_XML_TOTAL_BYTES,
  XML_ATTRIBUTE_WEIGHT,
  XML_ELEMENT_WEIGHT,
  XML_TEXT_NODE_WEIGHT,
} from './constants';

// '<' as a byte: every tag starts with one.
const TAG_OPEN_BYTE = 0x3c;
// '>' as a byte: every tag ends with one; text, if any, follows it.
const TAG_CLOSE_BYTE = 0x3e;
// '=' as a byte: every attribute carries one, so the count bounds the attribute nodes.
const EQUALS_BYTE = 0x3d;
const DOUBLE_QUOTE_BYTE = 0x22;
const SINGLE_QUOTE_BYTE = 0x27;
// After '<': '!' opens a comment, CDATA or DOCTYPE (the content scan rejects the
// latter), '?' a processing instruction. Neither is an element name.
const MARKUP_DECLARATION_BYTE = 0x21;
const PROCESSING_INSTRUCTION_BYTE = 0x3f;
// '/' after '<' opens an end tag; the name follows it.
const END_TAG_BYTE = 0x2f;
// Bytes that end an element name: space, tab, CR, LF, '/', '>'.
const NAME_END_BYTES: ReadonlySet<number> = new Set([0x20, 0x09, 0x0d, 0x0a, 0x2f, 0x3e]);
// 'xmlns': every namespace declaration attribute starts with these bytes.
const XMLNS_BYTES: readonly number[] = [0x78, 0x6d, 0x6c, 0x6e, 0x73];
// Zip bytes fed to the streaming inflater per push; see streamArchive.
const STREAM_CHUNK_BYTES = 8 * 1024;
// The officeDocument relationship type, transitional and strict: the root relationship
// that names the workbook part.
const OFFICE_DOCUMENT_RELATIONSHIP_TYPES: readonly string[] = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
];
const FOLDED_OFFICE_DOCUMENT_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set(
  OFFICE_DOCUMENT_RELATIONSHIP_TYPES.map(foldAsciiCase),
);
const RELATIONSHIP = 'Relationship';
const TYPE_ATTRIBUTE = 'Type';
const TARGET_ATTRIBUTE = 'Target';
const TARGET_MODE_ATTRIBUTE = 'TargetMode';
// The only TargetMode a root relationship to the workbook may carry, when it has one.
const INTERNAL_TARGET_MODE = 'Internal';
// A root relationship Target is relative to the package root; one leading '/' is the same.
const PACKAGE_ROOT_PREFIX = '/';
// The root relationships part belongs to the package, never to a worksheet.
const ROOT_RELS_SOURCE: RelationshipsSourceKind = 'other';

export interface GuardOpts {
  rowCap: number;
  colCap: number;
  maxBytes: number;
  /** Callers may LOWER this below MAX_DECOMPRESSED_BYTES (e.g. in tests); raising above the absolute cap is silently clamped. */
  maxDecompressedBytes?: number;
  /** Callers may LOWER this below MAX_XML_DOM_WEIGHT (e.g. in tests); higher values are clamped. */
  maxDomWeight?: number;
}

/** The reader parts of an upload, by entry name, in the order the gate picked them. */
export type UploadParts = Readonly<Record<string, Uint8Array>>;

/** The reader parts of an upload and the zip layout the gate walked. */
export interface OpenedUpload {
  readonly parts: UploadParts;
  readonly layout: ZipLayout;
}

/** What the local-header stream delivered. */
interface StreamedArchive {
  /**
   * Content of every entry whose content is XML (the only entries kept, the root
   * relationships part aside), by name. Only those named .xml / .xml.rels can be a
   * reader part.
   */
  readonly contents: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  /** Content of the entry named exactly `_rels/.rels`, kept beside `contents`; null without one. */
  readonly rootRels: Uint8Array<ArrayBuffer> | null;
  /** Name of every entry (names are unique). */
  readonly names: ReadonlySet<string>;
  /** Inflated byte count of every entry, by name. */
  readonly sizes: ReadonlyMap<string, number>;
  /** What the first bytes of every entry say it holds, by name. */
  readonly kinds: ReadonlyMap<string, EntryContentKind>;
}

/** Running DOM weight of the reader parts together, against its limit. */
interface XmlDomWeight {
  readonly limit: number;
  total: number;
}

function hasXlsxMagic(file: Uint8Array): boolean {
  // XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04] — zip local-file-header signature.
  // With noUncheckedIndexedAccess, file[i] is number | undefined; comparing to
  // number is valid strict equality (undefined === 0x50 is false, so every() returns false).
  return XLSX_MAGIC.every((b, i) => file[i] === b);
}

function causeOf(e: unknown): string {
  return String(e).slice(0, MAX_ERROR_CAUSE_LENGTH);
}

function corruptArchive(message: string, meta: Record<string, unknown> = {}): SpreadsheetFileError {
  return new SpreadsheetFileError('CORRUPT_FILE', message, meta);
}

function concatChunks(chunks: readonly Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const first = chunks[0];
  if (chunks.length === 1 && first !== undefined) return first;
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Inflates EVERY entry of the archive from its local headers with fflate's
 * streaming Unzip and returns the real inflated size, name and content kind of every
 * entry, plus the content of every entry whose content is XML, whatever its name (an
 * opener finds a part by its relationship; content-scan.ts, "Which entries are XML"),
 * and of the root relationships part (`_rels/.rels`, kept apart). Each entry's first
 * bytes are held, counted with the kept ones, until they decide its kind; any other
 * entry (an image, a binary part) is inflated only to count its bytes, which are dropped
 * once its kind is known: the export unzips the stored upload whole and allocates each
 * entry's declared size, so every entry must be measured here, not only the parts the
 * reader opens. The ceilings fire from REAL inflated bytes, never from a size field the
 * upload declares:
 *   - more than MAX_ZIP_ENTRIES entries, every entry together beyond
 *     `decompressedCap`, the kept and the undecided entries but the root relationships
 *     part together beyond MAX_XML_TOTAL_BYTES, or the root relationships part beyond
 *     MAX_WORKBOOK_RELS_BYTES: PAYLOAD_TOO_LARGE;
 *   - an entry that does not finish, or fflate's own error: CORRUPT_FILE.
 * The entries are those of the zip layout readZipLayout accepted, whose names are
 * unique, so the stream meets each name once.
 *
 * abortReason is set (not thrown) inside the callbacks: fflate catches a throw from
 * ondata and re-delivers it as the `err` argument, losing the original code. The
 * zip is fed in small chunks because fflate's synchronous UnzipInflate finishes the
 * in-flight chunk before push() returns, so a ceiling can only stop at chunk
 * boundaries; a small chunk bounds the overshoot to ~STREAM_CHUNK_BYTES x the
 * maximum deflate ratio.
 */
function streamArchive(bytes: Uint8Array, decompressedCap: number): StreamedArchive {
  const chunksByName = new Map<string, Uint8Array<ArrayBuffer>[]>();
  const rootRelsChunks: Uint8Array<ArrayBuffer>[] = [];
  const names = new Set<string>();
  const sizes = new Map<string, number>();
  const kinds = new Map<string, EntryContentKind>();
  const unfinished = new Set<string>();
  let inflatedBytes = 0;
  let xmlBytes = 0;
  let rootRelsBytes = 0;
  let abortReason: SpreadsheetFileError | null = null;

  const unzipper = new Unzip();
  unzipper.register(UnzipInflate); // Required for DEFLATE (compression method 8)

  unzipper.onfile = (f) => {
    if (abortReason !== null) return;
    const name = f.name;
    if (names.size >= MAX_ZIP_ENTRIES) {
      abortReason = new SpreadsheetFileError('PAYLOAD_TOO_LARGE', 'Too many zip entries', {
        entries: names.size + 1,
      });
      return; // f.start() is not called: no callbacks fire for this entry.
    }
    names.add(name);
    sizes.set(name, 0);
    unfinished.add(name);
    // XML content is kept, the root relationships part apart; the first bytes of every
    // other entry are held until they decide its kind, then it is counted and dropped.
    const isRootRels = name === ROOT_RELS_PART;
    const sniff = createEntryContentSniff();
    const held: Uint8Array<ArrayBuffer>[] = [];
    let heldBytes = 0;

    f.ondata = (err, chunk, final) => {
      if (abortReason !== null) return;
      if (err !== null) {
        abortReason = corruptArchive('Inflate failed during streaming guard', {
          cause: causeOf(err),
        });
        return;
      }
      inflatedBytes += chunk.length;
      sizes.set(name, (sizes.get(name) ?? 0) + chunk.length);
      if (final) unfinished.delete(name);
      feedEntryContentSniff(sniff, chunk);
      if (final) kinds.set(name, finishEntryContentSniff(sniff));
      if (inflatedBytes > decompressedCap) {
        abortReason = new SpreadsheetFileError(
          'PAYLOAD_TOO_LARGE',
          'Decompressed size exceeds cap',
          { cap: decompressedCap },
        );
        return;
      }
      if (isRootRels) {
        rootRelsBytes += chunk.length;
        if (rootRelsBytes > MAX_WORKBOOK_RELS_BYTES) {
          abortReason = new SpreadsheetFileError(
            'PAYLOAD_TOO_LARGE',
            `Root relationships part exceeds ${MAX_WORKBOOK_RELS_BYTES}B`,
            { entry: ROOT_RELS_PART, cap: MAX_WORKBOOK_RELS_BYTES },
          );
          return;
        }
        rootRelsChunks.push(chunk);
        return;
      }
      if (sniff.kind !== null && sniff.kind !== 'xml') {
        // Not XML, or XML the scans cannot read: what was held is dropped.
        xmlBytes -= heldBytes;
        heldBytes = 0;
        held.length = 0;
        return;
      }
      xmlBytes += chunk.length;
      heldBytes += chunk.length;
      if (xmlBytes > MAX_XML_TOTAL_BYTES) {
        abortReason = new SpreadsheetFileError(
          'PAYLOAD_TOO_LARGE',
          `Workbook XML parts exceed ${MAX_XML_TOTAL_BYTES}B`,
          { cap: MAX_XML_TOTAL_BYTES },
        );
        return;
      }
      held.push(chunk);
      if (final) chunksByName.set(name, held);
    };
    f.start();
  };

  try {
    for (let i = 0; i < bytes.length; i += STREAM_CHUNK_BYTES) {
      if (abortReason !== null) break;
      const isLast = i + STREAM_CHUNK_BYTES >= bytes.length;
      unzipper.push(bytes.subarray(i, Math.min(i + STREAM_CHUNK_BYTES, bytes.length)), isLast);
    }
  } catch (e) {
    // fflate itself threw (structural zip corruption not reported through ondata).
    // Don't override an already-set abortReason.
    if (abortReason === null) {
      abortReason = corruptArchive('Unexpected error during zip inspection', {
        cause: causeOf(e),
      });
    }
  }
  if (abortReason !== null) throw abortReason;
  if (unfinished.size > 0) throw corruptArchive('Zip entry ends before its data does');

  const contents = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [name, chunks] of chunksByName) contents.set(name, concatChunks(chunks));
  const rootRels = names.has(ROOT_RELS_PART) ? concatChunks(rootRelsChunks) : null;
  return { contents, rootRels, names, sizes, kinds };
}

/**
 * For EVERY entry of the central directory, the declared uncompressed size equals the
 * bytes the stream actually inflated. Otherwise CORRUPT_FILE: readZipLayout proves the
 * directory and the local headers name the same entries with the same sizes, but it
 * inflates nothing, so a deflated entry whose headers all declare a size its data does
 * not inflate to passes it. With every declared size proven real, an unzip of the stored
 * upload that allocates the declared sizes allocates at most the decompression cap.
 */
function assertCentralDirectoryMatches(layout: ZipLayout, streamed: StreamedArchive): void {
  for (const entry of layout.entries) {
    const size = streamed.sizes.get(entry.name);
    if (entry.uncompressedSize !== size) {
      throw corruptArchive('Zip central directory declares a size the entry does not have', {
        declared: entry.uncompressedSize,
        actual: size,
      });
    }
  }
}

/**
 * Length in bytes of the element name that starts right after the '<' at
 * `from - 1`: 0 for a comment, CDATA, DOCTYPE or processing instruction; an end
 * tag's '/' is skipped. The name runs to the first NAME_END_BYTES byte or the end
 * of the part. Counting stops one byte past MAX_XML_NAME_LENGTH, so each '<' costs
 * a bounded number of steps and the whole scan stays linear.
 */
function elementNameLength(bytes: Uint8Array, from: number): number {
  const first = bytes[from];
  if (first === MARKUP_DECLARATION_BYTE || first === PROCESSING_INSTRUCTION_BYTE) return 0;
  const start = first === END_TAG_BYTE ? from + 1 : from;
  let end = start;
  while (end < bytes.length && end - start <= MAX_XML_NAME_LENGTH) {
    const byte = bytes[end];
    if (byte === undefined || NAME_END_BYTES.has(byte)) break;
    end += 1;
  }
  return end - start;
}

/**
 * DOM weight of the markup opened by the '<' right before `from`: an end tag adds
 * no node, a comment, CDATA section or processing instruction ('!' or '?'; the
 * content scan rejects a DOCTYPE) adds one text-like node, anything else an element.
 */
function tagWeight(bytes: Uint8Array, from: number): number {
  const next = bytes[from];
  if (next === END_TAG_BYTE) return 0;
  if (next === MARKUP_DECLARATION_BYTE || next === PROCESSING_INSTRUCTION_BYTE) {
    return XML_TEXT_NODE_WEIGHT;
  }
  return XML_ELEMENT_WEIGHT;
}

/**
 * Whether the '>' at `at - 1` is followed by text: any byte but '<'. Every run of
 * text or whitespace between tags starts right after a '>', so it is counted at
 * least once; a '>' inside an attribute value or text only adds to the count.
 */
function startsText(bytes: Uint8Array, at: number): boolean {
  const next = bytes[at];
  return next !== undefined && next !== TAG_OPEN_BYTE;
}

function startsWithBytes(bytes: Uint8Array, at: number, expected: readonly number[]): boolean {
  return expected.every((byte, offset) => bytes[at + offset] === byte);
}

function xmlDomWeight(opts: GuardOpts): XmlDomWeight {
  return {
    limit: Math.min(opts.maxDomWeight ?? MAX_XML_DOM_WEIGHT, MAX_XML_DOM_WEIGHT),
    total: 0,
  };
}

function addDomWeight(name: string, weight: XmlDomWeight, amount: number): void {
  weight.total += amount;
  if (weight.total > weight.limit) {
    throw new SpreadsheetFileError(
      'PAYLOAD_TOO_LARGE',
      `Workbook parts exceed a DOM weight of ${weight.limit}`,
      { entry: name, cap: weight.limit },
    );
  }
}

/**
 * The start tag being scanned: whether one is open, the quote that opened the
 * attribute value being read (0 outside a value), and its attribute names and '='
 * separators so far, both counted outside quoted values.
 */
interface StartTagScan {
  open: boolean;
  quote: number;
  names: number;
  equals: number;
}

function newStartTag(): StartTagScan {
  return { open: false, quote: 0, names: 0, equals: 0 };
}

function isXmlWhitespace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/**
 * Follows one byte of an open start tag. An attribute name starts at a byte that
 * follows whitespace outside a quoted value and is not '=', '/', '>' or a quote; the
 * element name right after '<' follows no whitespace, so it is not counted. A '>'
 * outside a quoted value closes the tag.
 */
function observeStartTagByte(
  name: string,
  weight: XmlDomWeight,
  tag: StartTagScan,
  byte: number,
  previous: number | undefined,
): void {
  if (tag.quote !== 0) {
    if (byte === tag.quote) tag.quote = 0;
    return;
  }
  if (byte === DOUBLE_QUOTE_BYTE || byte === SINGLE_QUOTE_BYTE) {
    tag.quote = byte;
  } else if (byte === EQUALS_BYTE) {
    tag.equals += 1;
  } else if (byte === TAG_CLOSE_BYTE) {
    endStartTag(name, weight, tag);
  } else if (byte !== END_TAG_BYTE && !isXmlWhitespace(byte) && isXmlWhitespace(previous)) {
    tag.names += 1;
  }
}

/**
 * Closes the open start tag, if any. Every attribute with a value was charged at its
 * '=' byte; an attribute WITHOUT a value (`<z a1 a2/>`, which xmldom accepts with
 * only a warning yet still builds as a node) has no '=', so each name beyond the '='
 * count is charged here. A real workbook has one '=' per attribute, so its weight
 * does not change.
 */
function endStartTag(name: string, weight: XmlDomWeight, tag: StartTagScan): void {
  if (!tag.open) return;
  const valueless = tag.names - tag.equals;
  if (valueless > 0) addDomWeight(name, weight, valueless * XML_ATTRIBUTE_WEIGHT);
  tag.open = false;
  tag.quote = 0;
  tag.names = 0;
  tag.equals = 0;
}

/**
 * Budgets on the raw bytes of one part the reader opens, before any XML is decoded
 * or parsed (the total size is capped while streaming). One linear pass:
 *   - the DOM weight of the part is added to the running total of all reader parts,
 *     at most MAX_XML_DOM_WEIGHT (PAYLOAD_TOO_LARGE): XML_ELEMENT_WEIGHT per element
 *     start tag, XML_ATTRIBUTE_WEIGHT per '=' byte (plus one per attribute without a
 *     value, see endStartTag) and XML_TEXT_NODE_WEIGHT per text
 *     run (a '>' followed by anything but '<'), comment, CDATA section or
 *     processing instruction. This bounds the heap of the DOM the reader builds;
 *   - no element name, start or end tag, longer than MAX_XML_NAME_LENGTH bytes
 *     (UNSAFE_CONTENT). The old reader found elements with `tagName.replace(/.+:/,
 *     '')`, which is quadratic in the name length: a ~1.5 KB upload holding one
 *     40 000-byte name kept it busy for seconds. Bytes are at least characters, so
 *     the byte cap also caps the characters of every name;
 *   - at most MAX_XMLNS_DECLARATIONS_PER_PART occurrences of 'xmlns' in this part
 *     (UNSAFE_CONTENT, tooManyNamespaceDeclarations: the error the content scan raises
 *     for more declarations in any kept XML part): xmldom's namespace lookup is
 *     quadratic in nested declarations.
 */
function chargeXmlPart(name: string, bytes: Uint8Array, weight: XmlDomWeight): void {
  let declarations = 0;
  const startTag = newStartTag();
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) break;
    if (byte === TAG_OPEN_BYTE) {
      // A '<' before the previous start tag closed (not well-formed; the strict parse
      // rejects it later) still settles that tag's attributes.
      endStartTag(name, weight, startTag);
      const markupWeight = tagWeight(bytes, i + 1);
      startTag.open = markupWeight === XML_ELEMENT_WEIGHT;
      addDomWeight(name, weight, markupWeight);
      if (elementNameLength(bytes, i + 1) > MAX_XML_NAME_LENGTH) {
        throw new SpreadsheetFileError(
          'UNSAFE_CONTENT',
          `Workbook part '${name}' has an element name longer than ${MAX_XML_NAME_LENGTH}B`,
          { entry: name, cap: MAX_XML_NAME_LENGTH },
        );
      }
      continue;
    }
    if (startTag.open) observeStartTagByte(name, weight, startTag, byte, bytes[i - 1]);
    if (byte === TAG_CLOSE_BYTE) {
      if (startsText(bytes, i + 1)) addDomWeight(name, weight, XML_TEXT_NODE_WEIGHT);
    } else if (byte === EQUALS_BYTE) {
      addDomWeight(name, weight, XML_ATTRIBUTE_WEIGHT);
    } else if (byte === XMLNS_BYTES[0] && startsWithBytes(bytes, i, XMLNS_BYTES)) {
      declarations += 1;
      if (declarations > MAX_XMLNS_DECLARATIONS_PER_PART) {
        throw tooManyNamespaceDeclarations(name);
      }
    }
  }
  endStartTag(name, weight, startTag);
}

/**
 * Picks out the parts the grid reader opens (reader contract, section 1):
 * `xl/_rels/workbook.xml.rels`, `xl/workbook.xml`, then every styles, shared strings
 * and worksheet part the rels name (readerPartPaths). Each part is budgeted
 * (chargeXmlPart) on its raw bytes when it is picked; every kept XML part, these
 * included, was content-scanned before (assertSafeXmlContent), so the rels are checked
 * before they are parsed to resolve the rest. A part counts once however many
 * relationships name it. A part the reader would look up and not find (missing, or not
 * a kept entry named .xml / .xml.rels: the other kept entries are scanned, never read)
 * is CORRUPT_FILE, the error the reader would fail with. No other entry is budgeted,
 * parsed or copied.
 */
function selectReaderParts(
  contents: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
  opts: GuardOpts,
): UploadParts {
  const weight = xmlDomWeight(opts);
  const selected = new Map<string, Uint8Array<ArrayBuffer>>();
  const pick = (name: string): Uint8Array<ArrayBuffer> => {
    const bytes = isXmlPart(name) ? contents.get(name) : undefined;
    if (bytes === undefined) {
      throw corruptArchive('Workbook part the reader opens is missing', {
        entry: name.slice(0, MAX_ERROR_CAUSE_LENGTH),
      });
    }
    if (selected.has(name)) return bytes;
    chargeXmlPart(name, bytes, weight);
    selected.set(name, bytes);
    return bytes;
  };

  const rels = pick(WORKBOOK_RELS_PART);
  assertWorkbookRelsWithinCap(rels);
  pick(WORKBOOK_PART);
  for (const path of readerPartPaths(strFromU8(rels))) pick(path);
  return Object.fromEntries(selected);
}

/** CORRUPT_FILE `{ reason: 'root-rels', entry }`. */
function rootRelsError(entry: string, message: string): SpreadsheetFileError {
  return corruptArchive(message, {
    reason: ZIP_REJECT_REASONS.ROOT_RELS,
    entry: metaEntryName(entry),
  });
}

function isPackagePartError(error: unknown): error is SpreadsheetFileError {
  return (
    error instanceof SpreadsheetFileError && error.meta.reason === ZIP_REJECT_REASONS.PACKAGE_PART
  );
}

/**
 * Whether the root relationship scanned into `markup` is an officeDocument one that
 * names the workbook part: no TargetMode but `Internal`, and a Target that, with one
 * leading '/' removed, is exactly `xl/workbook.xml`. Its Type was checked by the caller.
 */
function namesWorkbookPart(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
): boolean {
  const mode = literalAttributeText(
    bytes,
    markup,
    attributes,
    TARGET_MODE_ATTRIBUTE,
    ROOT_RELS_PART,
  );
  if (mode !== null && mode !== INTERNAL_TARGET_MODE) return false;
  const target = literalAttributeText(bytes, markup, attributes, TARGET_ATTRIBUTE, ROOT_RELS_PART);
  if (target === null) return false;
  const path = target.startsWith(PACKAGE_ROOT_PREFIX)
    ? target.slice(PACKAGE_ROOT_PREFIX.length)
    : target;
  return path === WORKBOOK_PART;
}

/**
 * Whether the direct child scanned into `markup` is an officeDocument relationship
 * that names the workbook part. Throws UNSAFE_CONTENT `unsafe-part` for any other
 * relationship to an active part or to content outside the package (assertSafeTarget);
 * CORRUPT_FILE `root-rels` for an officeDocument relationship that names anything else
 * (an external one included), and for a Type that is an officeDocument type only once
 * trimmed and ASCII-folded (a loose reader would follow it).
 */
function isWorkbookRelationship(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
): boolean {
  if (!localNameIs(bytes, markup, RELATIONSHIP)) return false;
  const type = literalAttributeText(bytes, markup, attributes, TYPE_ATTRIBUTE, ROOT_RELS_PART);
  if (type === null) {
    assertSafeTarget(bytes, markup, attributes, type, ROOT_RELS_PART, ROOT_RELS_SOURCE);
    return false;
  }
  assertSafeRelationshipType(type, ROOT_RELS_PART);
  if (OFFICE_DOCUMENT_RELATIONSHIP_TYPES.includes(type)) {
    if (namesWorkbookPart(bytes, markup, attributes)) return true;
    throw rootRelsError(
      ROOT_RELS_PART,
      'Root relationships part has an officeDocument relationship to another part',
    );
  }
  if (FOLDED_OFFICE_DOCUMENT_RELATIONSHIP_TYPES.has(foldAsciiCase(type.trim()))) {
    throw rootRelsError(
      ROOT_RELS_PART,
      'Root relationships part has an officeDocument Type in another ASCII case or with spaces',
    );
  }
  assertSafeTarget(bytes, markup, attributes, type, ROOT_RELS_PART, ROOT_RELS_SOURCE);
  return false;
}

/** The officeDocument relationships of the root relationships part, every one checked. */
function workbookRelationshipCount(bytes: Uint8Array): number {
  let count = 0;
  cutRootChildren(bytes, ROOT_RELS_PART, (markup, attributes) => {
    if (isWorkbookRelationship(bytes, markup, attributes)) count += 1;
    return false;
  });
  return count;
}

/**
 * The root relationships rule: the office document the package's root relationships
 * part names, when there is one, is `xl/workbook.xml` (the part the reader opens), so
 * no opener starts from another workbook. An archive without the part is accepted: no
 * package a marketplace can open lacks it, so there is no second workbook to disagree
 * with. Otherwise, after the content scan (UNSAFE_CONTENT), the part is walked with the
 * strict lexer the calcChain cut uses, and it must hold at least one officeDocument
 * relationship, every one of them to the workbook part (isWorkbookRelationship); any
 * other relationship to an active part or to external content is UNSAFE_CONTENT
 * `unsafe-part`. Anything else, a part the walk cannot read whole (not UTF-8, another
 * declared encoding, no root element, an element below a relationship), markup outside
 * the lexer's subset or a value it cannot compare included: CORRUPT_FILE `root-rels`.
 * So is an entry whose name is `_rels/.rels` only once ASCII-folded (OPC folds part
 * names): the gate must not ignore a part another reader may follow.
 */
function assertRootRelationships(names: ReadonlySet<string>, rootRels: Uint8Array | null): void {
  for (const name of names) {
    if (name === ROOT_RELS_PART || foldAsciiCase(name) !== ROOT_RELS_PART) continue;
    throw rootRelsError(name, 'Root relationships part is named in another ASCII case');
  }
  if (rootRels === null) return;
  assertSafeXmlPart(ROOT_RELS_PART, rootRels);
  let count: number;
  try {
    count = workbookRelationshipCount(rootRels);
  } catch (error) {
    // The walk's own errors name the package part; here they are the root rels rule's.
    if (!isPackagePartError(error)) throw error;
    throw rootRelsError(ROOT_RELS_PART, error.message);
  }
  if (count === 0) {
    throw rootRelsError(ROOT_RELS_PART, 'Root relationships part names no office document');
  }
}

/**
 * Validates an xlsx upload on its bytes and returns the parts the grid reader opens:
 * the only bytes the reader ever parses. Every path either throws
 * SpreadsheetFileError or returns the parts (no fail-open). The parts are views of
 * the inflated content; the upload itself is not copied. The DOM checks run when
 * the parts are parsed (checkPart in part-checks.ts). See openUploadWithLayout for the
 * checks and their order.
 *
 * Throws SpreadsheetFileError on any violation. INTERNAL: not part of the public
 * package surface.
 */
export function openUpload(file: Uint8Array, opts: GuardOpts): UploadParts {
  return openUploadWithLayout(file, opts).parts;
}

/**
 * openUpload, which also returns the zip layout it walked: the export patch path
 * rewrites the archive from that layout, so a job walks it once.
 *
 * Check order:
 *   1. Compressed file size cap (no attacker-controlled metadata involved).
 *   2. Magic bytes: zip local-file-header PK\x03\x04 signature.
 *   3. readZipLayout: the only archive shape the export accepts (CORRUPT_FILE with a
 *      zip reason otherwise), so the stream below and the directory the export reads
 *      visit the same entries at the same offsets. Bounds-checked reads only; nothing
 *      is inflated, so it runs before the stream.
 *   4. assertNoUnsafePartNames on the layout's names (UNSAFE_CONTENT `unsafe-part`):
 *      a macro project, an external link or an embedded object by its usual name.
 *      Nothing is inflated.
 *   5. streamArchive: the ONLY source of entry content. Inflates every entry from
 *      the local headers, reads the first bytes of each to tell its content kind, and
 *      keeps only the content of the entries whose content is XML, whatever their name,
 *      and of `_rels/.rels` apart (any other entry is counted and dropped), with
 *      real-byte ceilings: entry count, all inflated bytes clamped to
 *      MAX_DECOMPRESSED_BYTES, the kept bytes to MAX_XML_TOTAL_BYTES, the root
 *      relationships part to MAX_WORKBOOK_RELS_BYTES.
 *   6. Structural check: entry list must contain [Content_Types].xml + xl/workbook.xml.
 *      Magic bytes alone only prove "is a zip"; a .docx or .jar also starts with PK.
 *   7. Central directory sizes: every entry of the layout (read from the directory,
 *      which readZipLayout proved names the same entries as the local headers) declares
 *      the size the stream inflated. Nothing is ever unzipped from the directory, so
 *      overlapping or repeated records cannot make the gate inflate one stream many
 *      times. An unzip of the stored upload that allocates the declared sizes stays
 *      within the cap.
 *   8. assertEntryContentKind on every entry's content kind: no XML the scans cannot
 *      read (UTF-16 or UTF-32), and no entry named .xml, .rels or .vml that does not hold
 *      XML (CORRUPT_FILE `part-encoding`).
 *   9. assertNoUnsafePackageParts on the streamed content: the content types and every
 *      kept relationships part declare no active part and no relationship that reaches
 *      outside the package (UNSAFE_CONTENT `unsafe-part`), each walked part is read
 *      whole (CORRUPT_FILE `package-part` otherwise), and no entry is spelled in another
 *      ASCII case than a part this rule walks. It returns the ids each worksheet's own
 *      relationships part gives an external hyperlink.
 *  10. assertSafeXmlContent on EVERY kept XML entry, whatever its name and whatever the
 *      relationships say about it (a worksheet no relationship of the exact type names,
 *      a VML drawing, or the entry behind a Target alias, is still handed on by the
 *      export): UTF-8 text only (CORRUPT_FILE `part-encoding`), then the content scan (a
 *      DOCTYPE, an ENTITY declaration, an unknown entity reference, a formula field
 *      outside the allow list, a macro assignment, an active element or a URL outside
 *      the package: UNSAFE_CONTENT), a hyperlink `location` taken for a URL fragment
 *      only when the hyperlink's relationship id is one of the external hyperlink ids
 *      of step 9. Linear in bytes the stream already capped; no DOM is built.
 *  11. selectReaderParts: the parts the reader opens (the workbook rels, the
 *      workbook, and the styles, shared strings and worksheet parts the rels name),
 *      each checked on its raw bytes before any DOM is built: the DOM weight of all
 *      of them together, element-name length and namespace declarations per part. A
 *      part the rels name that is not in the archive is CORRUPT_FILE. Every other entry
 *      is left out; the parts come back in the order they were picked.
 *  12. assertSameViews: every reader part equals the directory's entry of that name
 *      (CORRUPT_FILE `zip-view-mismatch`), each inflate bounded by the declared size.
 *  13. assertRootRelationships: the root relationships part names xl/workbook.xml
 *      (CORRUPT_FILE `root-rels`).
 *
 * Throws SpreadsheetFileError on any violation. INTERNAL: not part of the public
 * package surface.
 */
export function openUploadWithLayout(file: Uint8Array, opts: GuardOpts): OpenedUpload {
  // 1. Compressed size cap
  if (file.length > opts.maxBytes) {
    throw new SpreadsheetFileError(
      'PAYLOAD_TOO_LARGE',
      `File ${file.length}B exceeds ${opts.maxBytes}B`,
      { maxBytes: opts.maxBytes, received: file.length },
    );
  }

  // 2. Magic bytes: first 4 bytes must be PK\x03\x04
  if (!hasXlsxMagic(file)) {
    throw new SpreadsheetFileError(
      'NOT_XLSX',
      'Missing zip magic bytes — not a zip or xlsx file',
      {},
    );
  }

  // 3. The zip layout the export reads; nothing is inflated.
  const layout = readZipLayout(file);

  // 4. Active parts by their usual names, before anything is inflated.
  assertNoUnsafePartNames(layout.entries.map((entry) => entry.name));

  // 5. Streaming inflate: the entry content. effectiveDecompCap clamps the caller's
  //    override downward only.
  const effectiveDecompCap = Math.min(
    opts.maxDecompressedBytes ?? MAX_DECOMPRESSED_BYTES,
    MAX_DECOMPRESSED_BYTES,
  );
  const streamed = streamArchive(file, effectiveDecompCap);

  // 6. Structural check: presence of required xlsx part names.
  if (!streamed.names.has(CONTENT_TYPES_PART) || !streamed.names.has(WORKBOOK_PART)) {
    throw new SpreadsheetFileError(
      'NOT_XLSX',
      `Not an xlsx file — missing required workbook parts (${CONTENT_TYPES_PART}, xl/workbook.xml)`,
      { found: [...streamed.names] },
    );
  }

  // 7. Every size the central directory declares is the size the stream inflated.
  assertCentralDirectoryMatches(layout, streamed);

  // 8. Every entry holds XML the scans read, or no XML and a name that promises none.
  for (const [name, kind] of streamed.kinds) assertEntryContentKind(name, kind);

  // 9. Active parts by their declared content and relationship types.
  const externalHyperlinks = assertNoUnsafePackageParts(streamed.names, streamed.contents);

  // 10. Every kept XML part, the reader's or not: UTF-8 text, then the content scan.
  assertSafeXmlContent(streamed.contents, externalHyperlinks);

  // 11. The parts the reader opens, budgeted on raw bytes.
  const parts = selectReaderParts(streamed.contents, opts);

  // 12. Each reader part is the directory's entry of that name.
  assertSameViews(file, layout, parts);

  // 13. The root relationships name the workbook the reader opens.
  assertRootRelationships(streamed.names, streamed.rootRels);
  return { parts, layout };
}
