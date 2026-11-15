import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import { SpreadsheetFileError } from './errors';
import {
  assertEntryContentKind,
  assertSafeXmlContent,
  assertSafeXmlPart,
  assertUtf8Text,
  createEntryContentSniff,
  createFormulaScanBudget,
  feedEntryContentSniff,
  finishEntryContentSniff,
  isXmlPart,
  NO_HYPERLINK_IDS,
  tooManyNamespaceDeclarations,
  type EntryContentKind,
  type FormulaScanBudget,
} from './content-scan';
import { cutRootChildren, literalAttributeText, type ChildSelector } from './patch/calc-chain';
import { entryNameByteLength, readZipLayout, type ZipLayout } from './patch/raw-zip';
import { ZIP_REJECT_REASONS } from './patch/reasons';
import { foldAsciiCase, metaEntryName, viewMismatch } from './patch/shared';
import { localNameIs, NAMESPACE_DECLARATION, type XmlMarkup } from './patch/xml-lexer';
import { assertSameViews } from './patch/zip-views';
import {
  assertNoUnsafePackageParts,
  assertNoUnsafePartNames,
  assertRelationshipElementSpelling,
  assertSafeRelationshipType,
  assertSafeTarget,
  contentScanPlan,
  relationshipsRootCheck,
  relationshipTargetMode,
  type RelationshipsSourceKind,
  type RelationshipTargetMode,
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
// Every namespace declaration attribute starts with these bytes: NAMESPACE_DECLARATION,
// encoded once.
const XMLNS_BYTES: readonly number[] = Array.from(new TextEncoder().encode(NAMESPACE_DECLARATION));
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
// A root relationship Target is relative to the package root; one leading '/' is the same.
const PACKAGE_ROOT_PREFIX = '/';
// The root relationships part belongs to the package, never to a worksheet.
const ROOT_RELS_SOURCE: RelationshipsSourceKind = 'other';
// The entry name rule (assertCanonicalEntryNames): '/'-separated segments of these
// characters only, none of them '.' or '..'.
const ENTRY_NAME_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const ENTRY_NAME_SEPARATOR = '/';
const CURRENT_FOLDER_SEGMENT = '.';
const PARENT_FOLDER_SEGMENT = '..';
// The declared size of the only entry whose name may end with ENTRY_NAME_SEPARATOR.
const EMPTY_ENTRY_SIZE = 0;

export interface GuardOpts {
  rowCap: number;
  colCap: number;
  maxBytes: number;
  /** Callers may LOWER this below MAX_DECOMPRESSED_BYTES (e.g. in tests); raising above the absolute cap is silently clamped. */
  maxDecompressedBytes?: number;
  /** Callers may LOWER this below MAX_XML_DOM_WEIGHT (e.g. in tests); higher values are clamped. */
  maxDomWeight?: number;
  /** Callers may LOWER this below MAX_FORMULA_SCAN_UNITS (e.g. in tests); higher values are clamped. */
  maxFormulaScanUnits?: number;
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

/**
 * Whether `name`, the name of an entry `empty` or not, is a canonical part name: exactly
 * the content types part's name, or '/'-separated segments of ENTRY_NAME_SEGMENT
 * characters, none of them empty (no leading '/', no '//'), '.' or '..'. A single
 * trailing '/' (a folder entry) is accepted on an empty entry only.
 */
function isCanonicalEntryName(name: string, empty: boolean): boolean {
  if (name === CONTENT_TYPES_PART) return true;
  const isFolder = empty && name.endsWith(ENTRY_NAME_SEPARATOR);
  const path = isFolder ? name.slice(0, -ENTRY_NAME_SEPARATOR.length) : name;
  return path
    .split(ENTRY_NAME_SEPARATOR)
    .every(
      (segment) =>
        ENTRY_NAME_SEGMENT.test(segment) &&
        segment !== CURRENT_FOLDER_SEGMENT &&
        segment !== PARENT_FOLDER_SEGMENT,
    );
}

/**
 * The entry name rule, on the names of the zip layout only: nothing is inflated. Every
 * entry name must be a canonical part name (isCanonicalEntryName) whose byte length
 * equals its character count (the name the stream decodes drops a leading byte order
 * mark another reader keeps). Otherwise CORRUPT_FILE `{ reason: 'entry-name',
 * entry }`: the gate compares part names exactly, string to string, and a name a packaging
 * reader resolves another way (a backslash, a leading '/', a percent escape, a letter
 * outside ASCII that folds to an ASCII one, an ECMA-376 interleaved piece such as
 * `name/[0].piece` it joins into one part) would reach a part the gate never read.
 */
function assertCanonicalEntryNames(file: Uint8Array, layout: ZipLayout): void {
  for (const entry of layout.entries) {
    const canonical =
      isCanonicalEntryName(entry.name, entry.uncompressedSize === EMPTY_ENTRY_SIZE) &&
      entryNameByteLength(file, entry) === entry.name.length;
    if (canonical) continue;
    throw corruptArchive('Zip entry name is not a canonical part name', {
      reason: ZIP_REJECT_REASONS.ENTRY_NAME,
      entry: metaEntryName(entry.name),
    });
  }
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
 * unique, so the stream meets each name once and meets `layoutEntries` entries. A
 * backstop holds both, fail closed: a name the stream meets twice, or another number of
 * entries than `layoutEntries`, is CORRUPT_FILE `zip-view-mismatch`.
 * INTERNAL, exported for its tests only: readZipLayout refuses every archive known to
 * break either before the stream runs.
 *
 * abortReason is set (not thrown) inside the callbacks: fflate catches a throw from
 * ondata and re-delivers it as the `err` argument, losing the original code. The
 * zip is fed in small chunks because fflate's synchronous UnzipInflate finishes the
 * in-flight chunk before push() returns, so a ceiling can only stop at chunk
 * boundaries; a small chunk bounds the overshoot to ~STREAM_CHUNK_BYTES x the
 * maximum deflate ratio.
 */
export function streamArchive(
  bytes: Uint8Array,
  layoutEntries: number,
  decompressedCap: number,
): StreamedArchive {
  const chunksByName = new Map<string, Uint8Array<ArrayBuffer>[]>();
  const rootRelsChunks: Uint8Array<ArrayBuffer>[] = [];
  const names = new Set<string>();
  const sizes = new Map<string, number>();
  const kinds = new Map<string, EntryContentKind>();
  const unfinished = new Set<string>();
  let streamedEntries = 0;
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
    streamedEntries += 1;
    if (names.has(name)) {
      abortReason = viewMismatch(name, 'Zip stream meets an entry name twice');
      return;
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
  if (streamedEntries !== layoutEntries) {
    throw corruptArchive('Zip stream meets another number of entries than the directory lists', {
      reason: ZIP_REJECT_REASONS.VIEW_MISMATCH,
      streamed: streamedEntries,
      listed: layoutEntries,
    });
  }

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
 * included, was content-scanned before (once: by the package walk or by
 * assertSafeXmlContent), so the rels are checked before they are parsed to resolve the
 * rest. A part counts once however many
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

/** Every XML part the gate kept and scans, by name: the kept XML entries, then `_rels/.rels`. */
function keptXmlParts(streamed: StreamedArchive): (readonly [string, Uint8Array])[] {
  const kept: (readonly [string, Uint8Array])[] = [...streamed.contents];
  if (streamed.rootRels !== null) kept.push([ROOT_RELS_PART, streamed.rootRels]);
  return kept;
}

/** CORRUPT_FILE `{ reason: 'root-rels', entry }`. */
function rootRelsError(entry: string, message: string): SpreadsheetFileError {
  return corruptArchive(message, {
    reason: ZIP_REJECT_REASONS.ROOT_RELS,
    entry: metaEntryName(entry),
  });
}

// The reasons the root relationships rule names `root-rels` instead: the part cannot be
// read whole (the lexer walk's), or is not UTF-8 text (assertUtf8Text's).
const ROOT_RELS_READ_REASONS: ReadonlySet<unknown> = new Set([
  ZIP_REJECT_REASONS.PACKAGE_PART,
  ZIP_REJECT_REASONS.PART_ENCODING,
]);

function isRootRelsReadError(error: unknown): error is SpreadsheetFileError {
  return error instanceof SpreadsheetFileError && ROOT_RELS_READ_REASONS.has(error.meta.reason);
}

/** `read()` on the root relationships part, its read errors named `root-rels` (rootRelsError). */
function readingRootRels<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (!isRootRelsReadError(error)) throw error;
    throw rootRelsError(ROOT_RELS_PART, error.message);
  }
}

/**
 * Whether the root relationship scanned into `markup`, of TargetMode `mode`
 * (relationshipTargetMode), is an officeDocument one that names the workbook part: it is
 * internal, and its Target, with one leading '/' removed, is exactly `xl/workbook.xml`.
 * Its Type was checked by the caller.
 */
function namesWorkbookPart(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  mode: RelationshipTargetMode,
): boolean {
  if (mode !== 'internal') return false;
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
 * trimmed and ASCII-folded (a loose reader would follow it). The TargetMode is read once
 * (relationshipTargetMode: any value but `Internal` or `External` is refused, named
 * `root-rels` by the caller).
 */
function isWorkbookRelationship(
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
): boolean {
  assertRelationshipElementSpelling(bytes, markup, ROOT_RELS_PART);
  if (!localNameIs(bytes, markup, RELATIONSHIP)) return false;
  const type = literalAttributeText(bytes, markup, attributes, TYPE_ATTRIBUTE, ROOT_RELS_PART);
  if (type === null) {
    const mode = relationshipTargetMode(bytes, markup, attributes, ROOT_RELS_PART);
    assertSafeTarget(bytes, markup, attributes, type, mode, ROOT_RELS_PART, ROOT_RELS_SOURCE);
    return false;
  }
  assertSafeRelationshipType(type, ROOT_RELS_PART);
  const mode = relationshipTargetMode(bytes, markup, attributes, ROOT_RELS_PART);
  if (OFFICE_DOCUMENT_RELATIONSHIP_TYPES.includes(type)) {
    if (namesWorkbookPart(bytes, markup, attributes, mode)) return true;
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
  assertSafeTarget(bytes, markup, attributes, type, mode, ROOT_RELS_PART, ROOT_RELS_SOURCE);
  return false;
}

/**
 * The officeDocument relationships of the root relationships part, every one checked;
 * its root and every child named a relationships element only in another ASCII case
 * refused (assertRelationshipElementSpelling).
 */
function workbookRelationshipCount(bytes: Uint8Array): number {
  let count = 0;
  const countWorkbookRelationship: ChildSelector = (markup, attributes) => {
    if (isWorkbookRelationship(bytes, markup, attributes)) count += 1;
    return false;
  };
  cutRootChildren(
    bytes,
    ROOT_RELS_PART,
    countWorkbookRelationship,
    relationshipsRootCheck(bytes, ROOT_RELS_PART),
  );
  return count;
}

/**
 * The root relationships rule: the office document the package's root relationships
 * part names, when there is one, is `xl/workbook.xml` (the part the reader opens), so
 * no opener starts from another workbook. An archive without the part is accepted: no
 * package a marketplace can open lacks it, so there is no second workbook to disagree
 * with. Otherwise the part must be UTF-8 text by the rule every kept XML part follows
 * (assertUtf8Text: valid UTF-8, no U+0000, no declaration of another encoding); then,
 * after the content scan (UNSAFE_CONTENT; its formula fields charged to `budget`, the
 * upload's), it is walked with the
 * strict lexer the calcChain cut uses, and it must hold at least one officeDocument
 * relationship, every one of them to the workbook part (isWorkbookRelationship); any
 * other relationship to an active part or to external content is UNSAFE_CONTENT
 * `unsafe-part`. Anything else, a part that is not UTF-8 text or that the walk cannot
 * read whole (no root element, an element below a relationship, a relationships element
 * named in another ASCII case), markup outside the lexer's subset or a value it cannot
 * compare included: CORRUPT_FILE `root-rels`.
 * So is an entry whose name is `_rels/.rels` only once ASCII-folded (OPC folds part
 * names): the gate must not ignore a part another reader may follow.
 */
function assertRootRelationships(
  names: ReadonlySet<string>,
  rootRels: Uint8Array | null,
  budget: FormulaScanBudget,
): void {
  for (const name of names) {
    if (name === ROOT_RELS_PART || foldAsciiCase(name) !== ROOT_RELS_PART) continue;
    throw rootRelsError(name, 'Root relationships part is named in another ASCII case');
  }
  if (rootRels === null) return;
  // The UTF-8 text rule of every kept XML part, then the content scan, then the walk.
  readingRootRels(() => assertUtf8Text(ROOT_RELS_PART, rootRels));
  assertSafeXmlPart(ROOT_RELS_PART, rootRels, NO_HYPERLINK_IDS, budget);
  const count = readingRootRels(() => workbookRelationshipCount(rootRels));
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
 *   4. assertCanonicalEntryNames on the layout's names (CORRUPT_FILE `entry-name`):
 *      every name is `[Content_Types].xml` or '/'-separated segments of
 *      [A-Za-z0-9._~-], none empty, '.' or '..', and its byte length equals its
 *      character count; a trailing '/' only on an empty entry. Nothing is inflated.
 *   5. assertNoUnsafePartNames on the layout's names (UNSAFE_CONTENT `unsafe-part`):
 *      a macro project, an external link or an embedded object by its usual name.
 *      Nothing is inflated.
 *   6. streamArchive: the ONLY source of entry content. Inflates every entry from
 *      the local headers, reads the first bytes of each to tell its content kind, and
 *      keeps only the content of the entries whose content is XML, whatever their name,
 *      and of `_rels/.rels` apart (any other entry is counted and dropped), with
 *      real-byte ceilings: entry count, all inflated bytes clamped to
 *      MAX_DECOMPRESSED_BYTES, the kept bytes to MAX_XML_TOTAL_BYTES, the root
 *      relationships part to MAX_WORKBOOK_RELS_BYTES. A name the stream meets twice, or
 *      another number of entries than the layout lists, is CORRUPT_FILE
 *      `zip-view-mismatch` (a backstop: readZipLayout refuses both first).
 *   7. Structural check: entry list must contain [Content_Types].xml + xl/workbook.xml.
 *      Magic bytes alone only prove "is a zip"; a .docx or .jar also starts with PK.
 *   8. Central directory sizes: every entry of the layout (read from the directory,
 *      which readZipLayout proved names the same entries as the local headers) declares
 *      the size the stream inflated. Nothing is ever unzipped from the directory, so
 *      overlapping or repeated records cannot make the gate inflate one stream many
 *      times. An unzip of the stored upload that allocates the declared sizes stays
 *      within the cap.
 *   9. assertEntryContentKind on every entry's content kind: no XML the scans cannot
 *      read (UTF-16, UTF-32 or EBCDIC), and no entry named .xml, .rels or .vml that does not hold
 *      XML (CORRUPT_FILE `part-encoding`).
 *  10. assertNoUnsafePackageParts on the streamed content: the content types and every
 *      kept relationships part (by its name or by its root element; contentScanPlan
 *      names them) declare no active part, no digital signature and no relationship that
 *      reaches outside the package (UNSAFE_CONTENT `unsafe-part`), each walked part is
 *      content-scanned (the content scan of step 11, run here so each part is scanned
 *      once) and read whole (CORRUPT_FILE `package-part` otherwise, a relationships
 *      element named in another ASCII case and a TargetMode other than `Internal` or
 *      `External` included), and no entry is spelled in another ASCII case than a part
 *      this rule walks. It returns the ids each worksheet's own relationships part gives
 *      an external hyperlink (only, or among others).
 *  11. assertSafeXmlContent on EVERY kept XML entry, whatever its name and whatever the
 *      relationships say about it (a worksheet no relationship of the exact type names,
 *      a VML drawing, or the entry behind a Target alias, is still handed on by the
 *      export): UTF-8 text only (CORRUPT_FILE `part-encoding`), then, for every entry
 *      step 10 did not content-scan (the same plan decides), the content scan (a
 *      DOCTYPE, an ENTITY declaration, an unknown entity reference, a formula field
 *      outside the allow list, a macro assignment, an active element or a URL outside
 *      the package: UNSAFE_CONTENT), a hyperlink `location` taken for a URL fragment
 *      only when the hyperlink's relationship id is one of the external hyperlink ids
 *      of step 10, and no other element naming one of them. Linear in bytes the stream
 *      already capped; no DOM is built. The formula fields the content scans of steps
 *      10, 11 and 14 read, raw and in NFKC form, are charged to one budget per upload,
 *      MAX_FORMULA_SCAN_UNITS or the caller's lower `maxFormulaScanUnits`
 *      (PAYLOAD_TOO_LARGE `formula-scan-budget` beyond it).
 *  12. selectReaderParts: the parts the reader opens (the workbook rels, the
 *      workbook, and the styles, shared strings and worksheet parts the rels name),
 *      each checked on its raw bytes before any DOM is built: the DOM weight of all
 *      of them together, element-name length and namespace declarations per part. A
 *      part the rels name that is not in the archive is CORRUPT_FILE. Every other entry
 *      is left out; the parts come back in the order they were picked.
 *  13. assertSameViews: every kept XML part (the reader parts among them) and the root
 *      relationships part equals the directory's entry of that name, inflated by zlib
 *      instead of fflate (CORRUPT_FILE `zip-view-mismatch`), each inflate bounded by the
 *      declared size: the scans judged bytes a second inflater reads the same way.
 *  14. assertRootRelationships: the root relationships part is UTF-8 text, passes the
 *      content scan (its one scan) and names xl/workbook.xml (CORRUPT_FILE `root-rels`).
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

  // 4. Canonical entry names, before anything is inflated.
  assertCanonicalEntryNames(file, layout);

  // 5. Active parts by their usual names, before anything is inflated.
  assertNoUnsafePartNames(layout.entries.map((entry) => entry.name));

  // 6. Streaming inflate: the entry content. effectiveDecompCap clamps the caller's
  //    override downward only.
  const effectiveDecompCap = Math.min(
    opts.maxDecompressedBytes ?? MAX_DECOMPRESSED_BYTES,
    MAX_DECOMPRESSED_BYTES,
  );
  const streamed = streamArchive(file, layout.entries.length, effectiveDecompCap);

  // 7. Structural check: presence of required xlsx part names.
  if (!streamed.names.has(CONTENT_TYPES_PART) || !streamed.names.has(WORKBOOK_PART)) {
    throw new SpreadsheetFileError(
      'NOT_XLSX',
      `Not an xlsx file — missing required workbook parts (${CONTENT_TYPES_PART}, xl/workbook.xml)`,
      { found: [...streamed.names] },
    );
  }

  // 8. Every size the central directory declares is the size the stream inflated.
  assertCentralDirectoryMatches(layout, streamed);

  // 9. Every entry holds XML the scans read, or no XML and a name that promises none.
  for (const [name, kind] of streamed.kinds) assertEntryContentKind(name, kind);

  // 10. Active parts by their declared content and relationship types; the parts it
  //     walks are content-scanned there, the others in step 11, each once.
  const formulaBudget = createFormulaScanBudget(opts.maxFormulaScanUnits);
  const scanPlan = contentScanPlan(streamed.contents);
  const externalHyperlinks = assertNoUnsafePackageParts(
    streamed.names,
    streamed.contents,
    scanPlan,
    formulaBudget,
  );

  // 11. Every kept XML part, the reader's or not: UTF-8 text, then the content scan of
  //     every part step 10 did not scan.
  assertSafeXmlContent(streamed.contents, externalHyperlinks, formulaBudget, scanPlan);

  // 12. The parts the reader opens, budgeted on raw bytes.
  const parts = selectReaderParts(streamed.contents, opts);

  // 13. Each kept XML part, the reader's and the root relationships included, is the
  //     directory's entry of that name.
  assertSameViews(file, layout, keptXmlParts(streamed));

  // 14. The root relationships name the workbook the reader opens.
  assertRootRelationships(streamed.names, streamed.rootRels, formulaBudget);
  return { parts, layout };
}
