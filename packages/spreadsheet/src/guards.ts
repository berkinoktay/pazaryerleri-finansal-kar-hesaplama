import { Unzip, UnzipInflate, strFromU8, unzipSync } from 'fflate';
import { SpreadsheetFileError } from './errors';
import { assertSafeXmlContent, isXmlPart } from './content-scan';
import {
  assertWorkbookRelsWithinCap,
  readerPartPaths,
  WORKBOOK_PART,
  WORKBOOK_RELS_PART,
} from './workbook-parts';
import {
  XLSX_MAGIC,
  MAX_ZIP_ENTRIES,
  MAX_DECOMPRESSED_BYTES,
  MAX_ERROR_CAUSE_LENGTH,
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

/** What the local-header stream delivered. */
interface StreamedArchive {
  /** Content of every entry named .xml / .xml.rels (the only entries kept), by name. */
  readonly contents: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  /** Name of every entry (names are unique). */
  readonly names: ReadonlySet<string>;
  /** Inflated byte count of every entry, by name. */
  readonly sizes: ReadonlyMap<string, number>;
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
 * streaming Unzip and returns the real inflated size and name of every entry, plus
 * the content of every entry named `.xml` or `.xml.rels`. Any other entry (an
 * image, a binary part) is inflated only to count its bytes, which are dropped as
 * they arrive: the export unzips the stored upload whole and allocates each
 * entry's declared size, so every entry must be measured here, not only the parts
 * the reader opens. The ceilings fire from REAL inflated bytes, never from a size
 * field the upload declares:
 *   - more than MAX_ZIP_ENTRIES entries, every entry together beyond
 *     `decompressedCap`, or the .xml / .xml.rels entries together beyond
 *     MAX_XML_TOTAL_BYTES: PAYLOAD_TOO_LARGE;
 *   - a repeated entry name, an entry that does not finish, or fflate's own error:
 *     CORRUPT_FILE.
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
  const names = new Set<string>();
  const sizes = new Map<string, number>();
  const unfinished = new Set<string>();
  let inflatedBytes = 0;
  let xmlBytes = 0;
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
    if (names.has(name)) {
      abortReason = corruptArchive('Zip archive repeats an entry name');
      return;
    }
    names.add(name);
    sizes.set(name, 0);
    unfinished.add(name);
    // Only .xml / .xml.rels content is kept; any other entry is counted and dropped.
    const kept: Uint8Array<ArrayBuffer>[] | null = isXmlPart(name) ? [] : null;
    if (kept !== null) chunksByName.set(name, kept);

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
      if (inflatedBytes > decompressedCap) {
        abortReason = new SpreadsheetFileError(
          'PAYLOAD_TOO_LARGE',
          'Decompressed size exceeds cap',
          { cap: decompressedCap },
        );
        return;
      }
      if (kept === null) return;
      xmlBytes += chunk.length;
      if (xmlBytes > MAX_XML_TOTAL_BYTES) {
        abortReason = new SpreadsheetFileError(
          'PAYLOAD_TOO_LARGE',
          `Workbook XML parts exceed ${MAX_XML_TOTAL_BYTES}B`,
          { cap: MAX_XML_TOTAL_BYTES },
        );
        return;
      }
      kept.push(chunk);
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
  return { contents, names, sizes };
}

/**
 * Lists the central directory WITHOUT inflating anything: the filter records each
 * entry and returns false, so fflate's unzipSync never slices or inflates an entry
 * (and never allocates from a declared size). More than MAX_ZIP_ENTRIES records, a
 * repeated name, or a directory fflate cannot read: CORRUPT_FILE.
 */
function listCentralDirectory(bytes: Uint8Array): Map<string, number> {
  const listed = new Map<string, number>();
  try {
    unzipSync(bytes, {
      filter: (entry) => {
        if (listed.size >= MAX_ZIP_ENTRIES) {
          throw corruptArchive('Zip central directory lists too many entries', {
            cap: MAX_ZIP_ENTRIES,
          });
        }
        if (listed.has(entry.name)) {
          throw corruptArchive('Zip central directory repeats an entry name');
        }
        listed.set(entry.name, entry.originalSize);
        return false;
      },
    });
  } catch (e) {
    if (e instanceof SpreadsheetFileError) throw e;
    throw corruptArchive('Cannot read the zip central directory', { cause: causeOf(e) });
  }
  return listed;
}

/**
 * The central directory must describe exactly the entries the stream delivered:
 * same names for every entry (both sides are unique, so equal counts plus every
 * streamed name found means equal sets), and for EVERY entry the declared
 * uncompressed size equals the bytes actually inflated. Otherwise CORRUPT_FILE:
 * another unzipper (or a later step) could see different entries than the gate did.
 * With every declared size proven real, the export's unzipSync of the stored upload
 * allocates at most the decompression cap in total.
 */
function assertCentralDirectoryMatches(
  listed: ReadonlyMap<string, number>,
  streamed: StreamedArchive,
): void {
  if (listed.size !== streamed.names.size) {
    throw corruptArchive('Zip central directory and local entries list different entries', {
      central: listed.size,
      local: streamed.names.size,
    });
  }
  for (const name of streamed.names) {
    const declared = listed.get(name);
    if (declared === undefined) {
      throw corruptArchive('Zip central directory and local entries name different entries');
    }
    const size = streamed.sizes.get(name);
    if (declared !== size) {
      throw corruptArchive('Zip central directory declares a size the entry does not have', {
        declared,
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
 *     (UNSAFE_CONTENT): xmldom's namespace lookup is quadratic in nested declarations.
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
        throw new SpreadsheetFileError(
          'UNSAFE_CONTENT',
          `Workbook part '${name}' has more than ${MAX_XMLNS_DECLARATIONS_PER_PART} namespace declarations`,
          { entry: name, cap: MAX_XMLNS_DECLARATIONS_PER_PART },
        );
      }
    }
  }
  endStartTag(name, weight, startTag);
}

/**
 * Picks out the parts the grid reader opens (reader contract, section 1):
 * `xl/_rels/workbook.xml.rels`, `xl/workbook.xml`, then every styles, shared strings
 * and worksheet part the rels name (readerPartPaths). Each part is budgeted
 * (chargeXmlPart) and content-scanned (assertSafeXmlContent) on its raw bytes when
 * it is picked, so the rels are checked before they are parsed to resolve the rest.
 * A part counts once however many relationships name it. A part the reader would
 * look up and not find (missing, or not a kept .xml / .xml.rels entry) is
 * CORRUPT_FILE, as the reader would fail on it. No other entry is budgeted,
 * scanned, parsed or copied.
 */
function selectReaderParts(
  contents: ReadonlyMap<string, Uint8Array<ArrayBuffer>>,
  opts: GuardOpts,
): UploadParts {
  const weight = xmlDomWeight(opts);
  const selected = new Map<string, Uint8Array<ArrayBuffer>>();
  const pick = (name: string): Uint8Array<ArrayBuffer> => {
    const bytes = contents.get(name);
    if (bytes === undefined) {
      throw corruptArchive('Workbook part the reader opens is missing', {
        entry: name.slice(0, MAX_ERROR_CAUSE_LENGTH),
      });
    }
    if (selected.has(name)) return bytes;
    chargeXmlPart(name, bytes, weight);
    assertSafeXmlContent({ [name]: bytes });
    selected.set(name, bytes);
    return bytes;
  };

  const rels = pick(WORKBOOK_RELS_PART);
  assertWorkbookRelsWithinCap(rels);
  pick(WORKBOOK_PART);
  for (const path of readerPartPaths(strFromU8(rels))) pick(path);
  return Object.fromEntries(selected);
}

/**
 * Validates an xlsx upload on its bytes and returns the parts the grid reader opens:
 * the only bytes the reader ever parses. Every path either throws
 * SpreadsheetFileError or returns the parts (no fail-open). The parts are views of
 * the inflated content; the upload itself is not copied. The DOM checks run when
 * the parts are parsed (checkPart in part-checks.ts).
 *
 * Check order:
 *   1. Compressed file size cap (no attacker-controlled metadata involved).
 *   2. Magic bytes: zip local-file-header PK\x03\x04 signature.
 *   3. streamArchive: the ONLY source of entry content. Inflates every entry from
 *      the local headers and keeps only the content of the entries named .xml /
 *      .xml.rels (any other entry is counted and dropped), with real-byte ceilings:
 *      entry count, all inflated bytes clamped to MAX_DECOMPRESSED_BYTES, the kept
 *      bytes to MAX_XML_TOTAL_BYTES.
 *   4. Structural check: entry list must contain [Content_Types].xml + xl/workbook.xml.
 *      Magic bytes alone only prove "is a zip"; a .docx or .jar also starts with PK.
 *   5. Central directory: listed without inflating anything, and it must name the
 *      same entries as the stream, with the same size for every entry. Nothing is
 *      ever unzipped from the directory, so overlapping or repeated records cannot
 *      make the gate inflate one stream many times, and the reader (which parses
 *      only these parts) cannot see entries the gate did not. The export unzips the
 *      stored upload whole, so its allocations stay within the cap.
 *   6. selectReaderParts: the parts the reader opens (the workbook rels, the
 *      workbook, and the styles, shared strings and worksheet parts the rels name),
 *      each checked on its raw bytes before any DOM is built: the DOM weight of all
 *      of them together, element-name length and namespace declarations per part,
 *      then the content scan (assertSafeXmlContent rejects a
 *      DOCTYPE, an ENTITY declaration or an unknown entity reference:
 *      UNSAFE_CONTENT). A part the rels name that is not in the archive is
 *      CORRUPT_FILE. Every other entry is left alone; the parts come back in the
 *      order they were picked.
 *
 * Throws SpreadsheetFileError on any violation. INTERNAL: not part of the public
 * package surface.
 */
export function openUpload(file: Uint8Array, opts: GuardOpts): UploadParts {
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

  // 3. Streaming inflate: the entry content. effectiveDecompCap clamps the caller's
  //    override downward only.
  const effectiveDecompCap = Math.min(
    opts.maxDecompressedBytes ?? MAX_DECOMPRESSED_BYTES,
    MAX_DECOMPRESSED_BYTES,
  );
  const streamed = streamArchive(file, effectiveDecompCap);

  // 4. Structural check: presence of required xlsx part names.
  if (!streamed.names.has('[Content_Types].xml') || !streamed.names.has(WORKBOOK_PART)) {
    throw new SpreadsheetFileError(
      'NOT_XLSX',
      'Not an xlsx file — missing required workbook parts ([Content_Types].xml, xl/workbook.xml)',
      { found: [...streamed.names] },
    );
  }

  // 5. The central directory must agree with the stream.
  assertCentralDirectoryMatches(listCentralDirectory(file), streamed);

  // 6. The parts the reader opens, budgeted and content-scanned on raw bytes.
  return selectReaderParts(streamed.contents, opts);
}
