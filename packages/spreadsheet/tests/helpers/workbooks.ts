import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { crc32, deflateRawSync } from 'node:zlib';

import type { ZipEntry, ZipLayout } from '../../src/patch/raw-zip';
import { buildXlsxFixture, worksheetXml } from '../../src/testing/build-xlsx';
import { readFixture } from './fixture-pins';
import { MAIN_NAMESPACE, sheet } from './patch-helpers';

// Workbooks the size tests grow from the committed fixtures, shared by the gate tests
// (guards.test.ts) and the worker tests.

const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const WORKBOOK_PART = 'xl/workbook.xml';
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const STYLES_PART = 'xl/styles.xml';
const SHEET_DATA_OPEN = '<sheetData>';
const SHEET_DATA_CLOSE = '</sheetData>';
// The start tag of a row or a cell, and the row number of the `r` reference inside it.
const ROW_OR_CELL_START_TAG = /<(?:row|c)\b[^>]*>/g;
const REFERENCE_ROW_NUMBER = /(\sr="[A-Z]*)\d+"/;

/** `rows` rows of `columns` numbers each, header row included. */
export function numberRows(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => r * columns + c),
  );
}

/** Text of the named entries of `file`, joined. */
export function entriesText(file: Buffer, names: readonly string[]): string {
  const entries = unzipSync(new Uint8Array(file));
  return names
    .map((name) => {
      const bytes = entries[name];
      if (bytes === undefined) throw new Error(`entry missing: ${name}`);
      return strFromU8(bytes);
    })
    .join('');
}

/** A worksheet whose `<row>` elements are repeated until it holds `rows` of them. */
interface GrownSheet {
  /** The worksheet text before the first row. */
  readonly head: string;
  /** The fixture's rows, repeated in order, verbatim. */
  readonly rows: readonly string[];
  /** The worksheet text after the last row. */
  readonly tail: string;
}

function growSheet(sheet: string, rows: number): GrownSheet {
  const start = sheet.indexOf(SHEET_DATA_OPEN) + SHEET_DATA_OPEN.length;
  const end = sheet.indexOf(SHEET_DATA_CLOSE);
  const fixtureRows = sheet.slice(start, end).match(/<row\b[\s\S]*?<\/row>\s*/g) ?? [];
  const grown = Array.from({ length: rows }, (_, i) => fixtureRows[i % fixtureRows.length] ?? '');
  return { head: sheet.slice(0, start), rows: grown, tail: sheet.slice(end) };
}

/** `row` with the row number of its own and of every cell's `r` reference set to `rowNumber`. */
function renumberRow(row: string, rowNumber: number): string {
  return row.replace(ROW_OR_CELL_START_TAG, (tag) =>
    tag.replace(REFERENCE_ROW_NUMBER, `$1${rowNumber}"`),
  );
}

/**
 * The reader parts of a real export, its sheet's rows repeated until it holds `rows`
 * rows (the rels, workbook, styles and shared strings parts unchanged), joined.
 */
export function grownFixtureText(file: string, rows: number): string {
  const upload = readFixture(file);
  const sheet = growSheet(entriesText(upload, [SHEET_PART]), rows);
  const others = entriesText(upload, [
    WORKBOOK_RELS_PART,
    WORKBOOK_PART,
    STYLES_PART,
    SHARED_STRINGS_PART,
  ]);
  return sheet.head + sheet.rows.join('') + sheet.tail + others;
}

/**
 * A real export whose sheet's rows are repeated until it holds `rows` rows, re-zipped
 * with every other entry unchanged. Each repeated row and its cells are renumbered to
 * its new position, so the grid it reads to has `rows` rows.
 */
export function grownFixtureWorkbook(file: string, rows: number): Buffer {
  const entries = unzipSync(new Uint8Array(readFixture(file)));
  const sheetBytes = entries[SHEET_PART];
  if (sheetBytes === undefined) throw new Error(`entry missing: ${SHEET_PART}`);
  const sheet = growSheet(strFromU8(sheetBytes), rows);
  const renumbered = sheet.rows.map((row, i) => renumberRow(row, i + 1));
  entries[SHEET_PART] = strToU8(sheet.head + renumbered.join('') + sheet.tail);
  return Buffer.from(zipSync(entries));
}

/** Local header, data and data descriptor of `entry`: a view into `file`, never a copy. */
export function rawSegment(file: Uint8Array, entry: ZipEntry): Buffer {
  return Buffer.from(
    file.buffer,
    file.byteOffset + entry.headerOffset,
    entry.segmentEnd - entry.headerOffset,
  );
}

// Crafted archives of the zip layout tests, most of them with a central directory that
// reads another worksheet than the local-header stream does. All are written by hand:
// local headers of 30 bytes plus the name (version 20), directory records of 46 bytes
// plus the name, a 22-byte end record; no extra field or comment unless noted, time and
// date zero.

const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50; // 'PK\x03\x04'
const ZIP_DIRECTORY_RECORD_SIGNATURE = 0x02014b50; // 'PK\x01\x02'
const ZIP_END_RECORD_SIGNATURE = 0x06054b50; // 'PK\x05\x06'
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50; // 'PK\x07\x08'
// Widths in bytes of the little-endian zip fields.
const U16 = 2;
const U32 = 4;
const ZIP_VERSION = 20;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;
const ZIP_NO_FLAGS = 0;
// General purpose flag bit 3: the crc and sizes follow the data in a data descriptor.
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
// Every field the hand-written headers leave empty: time, date, extra and comment
// lengths, disk numbers, attributes; and the crc and sizes of a bit-3 local header.
const ZIP_ZERO = 0;
// A data descriptor after its signature: the crc and two 32-bit sizes.
const ZIP_DESCRIPTOR_FIELDS_LENGTH = 12;
// A 32-bit size at its maximum: the size is in the zip64 extra field.
const ZIP64_SIZE = 0xffffffff;
// The zip64 extended information extra field: its tag, then both 64-bit sizes.
const ZIP64_EXTRA_TAG = 1;
const ZIP64_EXTRA_SIZES_LENGTH = 16;
// Unsigned data descriptors, by length: the crc, then both sizes in 32 bits or in 64.
const UNSIGNED_DESCRIPTOR_32_LENGTH = 12;
const UNSIGNED_DESCRIPTOR_64_LENGTH = 20;
const ZIP_SIGNATURE_LENGTH = U32;

const CONTENT_TYPES_PART = '[Content_Types].xml';
const HIDDEN_BLOB_PART = 'xl/media/blob.bin';
const HIDDEN_PROPERTIES_PART = 'docProps/app.xml';
const HIDDEN_PROPERTIES = '<Properties/>';
const HIDDEN_SHEET_NAME = 'Sheet1';
const HIDDEN_PRICE = 10;
const REAL_BARCODE = 'B1';
// Same length as REAL_BARCODE, so both sheets have the same length.
const OTHER_BARCODE = 'B2';

/** Zero bytes the 'bomb' tile deflates: far past any declared size, about 300 KB once deflated. */
export const HIDDEN_BOMB_BYTES = 300 * 1024 * 1024;

/** What the hidden tile of hiddenTileArchive holds. */
export type HiddenTileKind = 'other-sheet' | 'bomb' | 'same-sheet';

/** Where zip64SkipArchive hides the copy of the worksheet entry that the stream reads. */
export type Zip64SkipCopy = 'record-comment' | 'trailing-bytes';

// The entry right after docProps/app.xml, which the stream of zip64SkipArchive misses.
const ZIP64_SKIP_MISSED_ENTRY: Readonly<Record<Zip64SkipCopy, string>> = {
  'record-comment': SHEET_PART,
  'trailing-bytes': CONTENT_TYPES_PART,
};

/** The length of the unsigned data descriptor of unsignedDescriptorArchive. */
export type UnsignedDescriptorLength =
  | typeof UNSIGNED_DESCRIPTOR_32_LENGTH
  | typeof UNSIGNED_DESCRIPTOR_64_LENGTH;

export interface HiddenEntryArchive {
  readonly file: Buffer;
  /** What the local-header stream reads for `xl/worksheets/sheet1.xml`. */
  readonly realSheet: Uint8Array;
  /** What the central directory (and unzipSync) reads for it: same length, other cells. */
  readonly otherSheet: Uint8Array;
}

export interface HiddenTileArchive {
  readonly file: Buffer;
  readonly realSheet: Uint8Array;
  /** What the central directory describes, written out by hand: every entry, in directory order. */
  readonly layout: ZipLayout;
  /** The entry of `layout` named `W`: the hidden tile. */
  readonly tile: ZipEntry;
  /** Offsets in `file` of the two signatures planted inside `P`'s data: the fake descriptor's, then the fake header's. */
  readonly plantedSignatures: readonly [number, number];
}

export interface Zip64SkipArchive {
  readonly file: Buffer;
  /** What both the stream and the central directory read for `xl/worksheets/sheet1.xml`. */
  readonly realSheet: Uint8Array;
}

export interface CraftedArchive {
  readonly file: Buffer;
  /** What the central directory describes, written out by hand: every entry, in directory order. */
  readonly layout: ZipLayout;
}

/** What a local header or a directory record declares. */
interface ZipFields {
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

/** An entry as its directory record will describe it. */
interface WrittenEntry {
  readonly name: string;
  readonly fields: ZipFields;
  readonly headerOffset: number;
  readonly dataOffset: number;
  readonly segmentEnd: number;
  /** The extra field of its directory record; none when absent. */
  readonly extra?: Buffer;
  /** The comment of its directory record; none when absent. */
  readonly comment?: Buffer;
}

type ZipField = readonly [value: number, width: typeof U16 | typeof U32];

/** The bytes before the central directory, appended piece by piece. */
class ArchiveBody {
  readonly pieces: Buffer[] = [];
  length = 0;

  /** Appends `bytes` and returns their offset. */
  append(bytes: Buffer): number {
    const offset = this.length;
    this.pieces.push(bytes);
    this.length += bytes.length;
    return offset;
  }
}

/** `fields`, in order, as little-endian numbers. */
function littleEndian(fields: readonly ZipField[]): Buffer {
  const bytes = Buffer.alloc(fields.reduce((length, [, width]) => length + width, 0));
  let at = 0;
  for (const [value, width] of fields) {
    if (width === U16) bytes.writeUInt16LE(value, at);
    else bytes.writeUInt32LE(value, at);
    at += width;
  }
  return bytes;
}

function localHeader(name: string, fields: ZipFields, extra: Buffer = Buffer.alloc(0)): Buffer {
  const nameBytes = Buffer.from(name);
  const header = littleEndian([
    [ZIP_LOCAL_HEADER_SIGNATURE, U32],
    [ZIP_VERSION, U16],
    [fields.flags, U16],
    [fields.method, U16],
    [ZIP_ZERO, U16], // time
    [ZIP_ZERO, U16], // date
    [fields.crc32, U32],
    [fields.compressedSize, U32],
    [fields.uncompressedSize, U32],
    [nameBytes.length, U16],
    [extra.length, U16],
  ]);
  return Buffer.concat([header, nameBytes, extra]);
}

function directoryRecord(entry: WrittenEntry): Buffer {
  const nameBytes = Buffer.from(entry.name);
  const extra = entry.extra ?? Buffer.alloc(0);
  const comment = entry.comment ?? Buffer.alloc(0);
  const record = littleEndian([
    [ZIP_DIRECTORY_RECORD_SIGNATURE, U32],
    [ZIP_VERSION, U16], // version made by
    [ZIP_VERSION, U16], // version needed
    [entry.fields.flags, U16],
    [entry.fields.method, U16],
    [ZIP_ZERO, U16], // time
    [ZIP_ZERO, U16], // date
    [entry.fields.crc32, U32],
    [entry.fields.compressedSize, U32],
    [entry.fields.uncompressedSize, U32],
    [nameBytes.length, U16],
    [extra.length, U16],
    [comment.length, U16],
    [ZIP_ZERO, U16], // disk number
    [ZIP_ZERO, U16], // internal attributes
    [ZIP_ZERO, U32], // external attributes
    [entry.headerOffset, U32],
  ]);
  return Buffer.concat([record, nameBytes, extra, comment]);
}

function endRecord(count: number, directorySize: number, directoryOffset: number): Buffer {
  return littleEndian([
    [ZIP_END_RECORD_SIGNATURE, U32],
    [ZIP_ZERO, U16], // this disk
    [ZIP_ZERO, U16], // the directory's disk
    [count, U16],
    [count, U16],
    [directorySize, U32],
    [directoryOffset, U32],
    [ZIP_ZERO, U16], // comment length
  ]);
}

/** A 16-byte data descriptor: signature, crc, both sizes. */
function dataDescriptor(fields: ZipFields): Buffer {
  return littleEndian([
    [ZIP_DATA_DESCRIPTOR_SIGNATURE, U32],
    [fields.crc32, U32],
    [fields.compressedSize, U32],
    [fields.uncompressedSize, U32],
  ]);
}

function deflatedFields(content: Uint8Array, data: Buffer): ZipFields {
  return {
    flags: ZIP_NO_FLAGS,
    method: ZIP_DEFLATED,
    crc32: crc32(content),
    compressedSize: data.length,
    uncompressedSize: content.length,
  };
}

/** Appends a local header of `fields` without a data descriptor, then `data`. */
function appendEntry(
  body: ArchiveBody,
  name: string,
  fields: ZipFields,
  data: Buffer,
): WrittenEntry {
  const headerOffset = body.append(localHeader(name, fields));
  const dataOffset = body.append(data);
  return { name, fields, headerOffset, dataOffset, segmentEnd: body.length };
}

/** Appends a local header without a data descriptor, then the deflated `content`. */
function appendDeflated(body: ArchiveBody, name: string, content: Uint8Array): WrittenEntry {
  const data = deflateRawSync(content);
  return appendEntry(body, name, deflatedFields(content, data), data);
}

/** A deflated entry with flag bit 3, as its record and data descriptor declare it. */
function bit3Fields(content: Uint8Array, data: Buffer): ZipFields {
  return { ...deflatedFields(content, data), flags: ZIP_DATA_DESCRIPTOR_FLAG };
}

/** What a bit-3 local header declares: the flags and method, its crc and sizes left 0. */
function deferredFields(fields: ZipFields): ZipFields {
  return { ...fields, crc32: ZIP_ZERO, compressedSize: ZIP_ZERO, uncompressedSize: ZIP_ZERO };
}

/** `body`, then a directory record per entry of `entries` in that order, then the end record. */
function closeArchive(body: ArchiveBody, entries: readonly WrittenEntry[]): CraftedArchive {
  const directoryOffset = body.length;
  const records: Buffer[] = [];
  const described: ZipEntry[] = [];
  let recordOffset = directoryOffset;
  for (const entry of entries) {
    const record = directoryRecord(entry);
    described.push({
      name: entry.name,
      flags: entry.fields.flags,
      method: entry.fields.method,
      crc32: entry.fields.crc32,
      compressedSize: entry.fields.compressedSize,
      uncompressedSize: entry.fields.uncompressedSize,
      headerOffset: entry.headerOffset,
      dataOffset: entry.dataOffset,
      segmentEnd: entry.segmentEnd,
      recordOffset,
      recordLength: record.length,
    });
    records.push(record);
    recordOffset += record.length;
  }
  const end = endRecord(entries.length, recordOffset - directoryOffset, directoryOffset);
  return {
    file: Buffer.concat([...body.pieces, ...records, end]),
    layout: { entries: described, directoryOffset, endRecordOffset: recordOffset },
  };
}

function barcodeSheet(barcode: string): string {
  return worksheetXml([
    ['Barkod', 'Fiyat'],
    [barcode, HIDDEN_PRICE],
  ]);
}

/** The entries both crafted archives start from, and the two sheets they hide. */
interface HiddenBase {
  /** By name, in directory order. */
  readonly entries: Readonly<Record<string, Uint8Array>>;
  readonly realSheet: Uint8Array;
  readonly otherSheet: Uint8Array;
}

function hiddenBase(): HiddenBase {
  const workbook = buildXlsxFixture([{ name: HIDDEN_SHEET_NAME, xml: barcodeSheet(REAL_BARCODE) }]);
  const entries = unzipSync(new Uint8Array(workbook));
  const realSheet = entries[SHEET_PART];
  if (realSheet === undefined) throw new Error(`entry missing: ${SHEET_PART}`);
  const otherSheet = strToU8(barcodeSheet(OTHER_BARCODE));
  if (otherSheet.length !== realSheet.length) {
    throw new Error('the other sheet must have the length of the real one');
  }
  return { entries, realSheet, otherSheet };
}

/**
 * The hidden entry: the directory record of `xl/worksheets/sheet1.xml` points into
 * the data of `xl/media/blob.bin`, a STORED entry whose content is a complete local
 * entry of that name (header and deflated data) holding `otherSheet`. The stream reads
 * the real sheet where it stands and skips the blob by its size; the directory (and
 * unzipSync) reads `otherSheet`. Every name and declared size agrees between the two,
 * so today's gate accepts the file; its directory does not tile the file.
 */
export function hiddenEntryArchive(): HiddenEntryArchive {
  const { entries, realSheet, otherSheet } = hiddenBase();
  const body = new ArchiveBody();
  const written = Object.entries(entries).map(([name, content]) =>
    appendDeflated(body, name, content),
  );

  const otherData = deflateRawSync(otherSheet);
  const otherFields = deflatedFields(otherSheet, otherData);
  const innerHeader = localHeader(SHEET_PART, otherFields);
  const inner = Buffer.concat([innerHeader, otherData]);
  const blobFields: ZipFields = {
    flags: ZIP_NO_FLAGS,
    method: ZIP_STORED,
    crc32: crc32(inner),
    compressedSize: inner.length,
    uncompressedSize: inner.length,
  };
  const blobHeaderOffset = body.append(localHeader(HIDDEN_BLOB_PART, blobFields));
  const innerOffset = body.append(inner);
  const blob: WrittenEntry = {
    name: HIDDEN_BLOB_PART,
    fields: blobFields,
    headerOffset: blobHeaderOffset,
    dataOffset: innerOffset,
    segmentEnd: body.length,
  };
  // The directory record of the sheet, re-pointed at the inner header.
  const hidden: WrittenEntry = {
    name: SHEET_PART,
    fields: otherFields,
    headerOffset: innerOffset,
    dataOffset: innerOffset + innerHeader.length,
    segmentEnd: innerOffset + inner.length,
  };
  const directory = written.map((entry) => (entry.name === SHEET_PART ? hidden : entry));
  return { file: closeArchive(body, [...directory, blob]).file, realSheet, otherSheet };
}

let bombTileData: Buffer | undefined;

/** The deflated bomb, built once per test file: deflating it takes about a second. */
function bombTile(): Buffer {
  bombTileData ??= deflateRawSync(Buffer.alloc(HIDDEN_BOMB_BYTES));
  return bombTileData;
}

function tileData(tile: HiddenTileKind, base: HiddenBase): Buffer {
  switch (tile) {
    case 'other-sheet':
      return deflateRawSync(base.otherSheet);
    case 'bomb':
      return bombTile();
    case 'same-sheet':
      return deflateRawSync(base.realSheet);
    default: {
      const unhandled: never = tile;
      throw new Error(`Unhandled hidden tile: ${String(unhandled)}`);
    }
  }
}

/**
 * The hidden tile (`W` is `xl/worksheets/sheet1.xml`, `Y` its content). Physical order:
 *   1. every entry of the base workbook but `W`, without a data descriptor;
 *   2. `P` (`docProps/app.xml`) with flag bit 3: a local header (crc and sizes 0), its
 *      data and a real 16-byte descriptor. The data holds the deflated `<Properties/>`,
 *      a fake descriptor (the signature and 12 zero bytes), a fake local header of `W`
 *      whose compressed size runs to the directory, and the deflated `Y`;
 *   3. `T`, the hidden tile: a local header of `W` and the tile data (`tile` decides);
 *   4. the directory: the entries of step 1, `P` (its whole data as its compressed
 *      size), and `W` pointing at `T`; then the end record.
 * The stream ends `P` at the fake descriptor, reads `Y` behind the fake header and
 * skips everything up to the directory, `T` included. Every header, descriptor, size
 * and offset agrees with the directory, which tiles the file without a gap.
 */
export function hiddenTileArchive(tile: HiddenTileKind): HiddenTileArchive {
  const base = hiddenBase();
  const { realSheet } = base;
  const body = new ArchiveBody();
  const written = Object.entries(base.entries)
    .filter(([name]) => name !== SHEET_PART)
    .map(([name, content]) => appendDeflated(body, name, content));

  const tileBytes = tileData(tile, base);
  // The tile declares the crc and length of Y whatever it holds.
  const tileFields = deflatedFields(realSheet, tileBytes);
  const tileHeader = localHeader(SHEET_PART, tileFields);

  const properties = strToU8(HIDDEN_PROPERTIES);
  const deflatedProperties = deflateRawSync(properties);
  const deflatedSheet = deflateRawSync(realSheet);
  const fakeDescriptor = Buffer.concat([
    littleEndian([[ZIP_DATA_DESCRIPTOR_SIGNATURE, U32]]),
    Buffer.alloc(ZIP_DESCRIPTOR_FIELDS_LENGTH),
  ]);
  // Runs over the rest of P's data, P's real descriptor and all of T.
  const fakeHeader = localHeader(SHEET_PART, {
    ...deflatedFields(realSheet, deflatedSheet),
    compressedSize:
      deflatedSheet.length + fakeDescriptor.length + tileHeader.length + tileBytes.length,
  });
  const propertiesData = Buffer.concat([
    deflatedProperties,
    fakeDescriptor,
    fakeHeader,
    deflatedSheet,
  ]);
  const propertiesFields: ZipFields = {
    flags: ZIP_DATA_DESCRIPTOR_FLAG,
    method: ZIP_DEFLATED,
    crc32: crc32(properties),
    compressedSize: propertiesData.length,
    uncompressedSize: properties.length,
  };
  const propertiesHeaderOffset = body.append(
    localHeader(HIDDEN_PROPERTIES_PART, {
      ...propertiesFields,
      crc32: ZIP_ZERO,
      compressedSize: ZIP_ZERO,
      uncompressedSize: ZIP_ZERO,
    }),
  );
  const propertiesDataOffset = body.append(propertiesData);
  body.append(dataDescriptor(propertiesFields));
  const propertiesEntry: WrittenEntry = {
    name: HIDDEN_PROPERTIES_PART,
    fields: propertiesFields,
    headerOffset: propertiesHeaderOffset,
    dataOffset: propertiesDataOffset,
    segmentEnd: body.length,
  };

  const tileHeaderOffset = body.append(tileHeader);
  const tileDataOffset = body.append(tileBytes);
  const tileEntry: WrittenEntry = {
    name: SHEET_PART,
    fields: tileFields,
    headerOffset: tileHeaderOffset,
    dataOffset: tileDataOffset,
    segmentEnd: body.length,
  };

  const { file, layout } = closeArchive(body, [...written, propertiesEntry, tileEntry]);
  const hidden = layout.entries.find((entry) => entry.name === SHEET_PART);
  if (hidden === undefined) throw new Error('the hidden tile is missing from its layout');
  const fakeDescriptorOffset = propertiesDataOffset + deflatedProperties.length;
  return {
    file,
    realSheet,
    layout,
    tile: hidden,
    plantedSignatures: [fakeDescriptorOffset, fakeDescriptorOffset + fakeDescriptor.length],
  };
}

/**
 * Appends `docProps/app.xml` with flag bit 3: a local header whose crc is 0 and whose
 * sizes are 0xFFFFFFFF, with a zip64 extra field (both 64-bit sizes zero); then its
 * deflated data and a real 16-byte data descriptor. Its record carries the real crc and
 * sizes. The stream reads the descriptor as a zip64 one and resumes 4 bytes into the
 * next local header.
 */
function appendZip64Properties(body: ArchiveBody): WrittenEntry {
  const properties = strToU8(HIDDEN_PROPERTIES);
  const data = deflateRawSync(properties);
  const fields = bit3Fields(properties, data);
  const zip64Extra = Buffer.concat([
    littleEndian([
      [ZIP64_EXTRA_TAG, U16],
      [ZIP64_EXTRA_SIZES_LENGTH, U16],
    ]),
    Buffer.alloc(ZIP64_EXTRA_SIZES_LENGTH),
  ]);
  const localFields: ZipFields = {
    ...deferredFields(fields),
    compressedSize: ZIP64_SIZE,
    uncompressedSize: ZIP64_SIZE,
  };
  const headerOffset = body.append(localHeader(HIDDEN_PROPERTIES_PART, localFields, zip64Extra));
  const dataOffset = body.append(data);
  body.append(dataDescriptor(fields));
  return {
    name: HIDDEN_PROPERTIES_PART,
    fields,
    headerOffset,
    dataOffset,
    segmentEnd: body.length,
  };
}

/**
 * The zip64 local skip (`A` is `docProps/app.xml`, `W` the worksheet entry, `Y` its
 * content). `A` comes from appendZip64Properties, so the stream never reads the entry
 * right after it and scans on for the next local header signature, which `copy` plants:
 *   - 'record-comment': `W` right after `A`; the comment of `W`'s directory record holds
 *     a complete local entry of `W` with `Y`;
 *   - 'trailing-bytes': `[Content_Types].xml` (`B`, an entry without bit 3) right after
 *     `A`, then `W`. After the end of its deflate stream, `B`'s data holds a complete
 *     local entry of `B`, then one of `W` with `Y`, whose compressed size also covers
 *     the signature of the real `W`'s local header.
 * Every header, descriptor, size and offset agrees with the directory, which tiles the
 * file without a gap; both the stream and the directory read `Y` for `W`, but the
 * stream from the planted copy, which a rewrite of `W` does not reach.
 */
export function zip64SkipArchive(copy: Zip64SkipCopy): Zip64SkipArchive {
  const { entries, realSheet } = hiddenBase();
  const body = new ArchiveBody();
  const missed = ZIP64_SKIP_MISSED_ENTRY[copy];
  const written = Object.entries(entries)
    .filter(([name]) => name !== SHEET_PART && name !== missed)
    .map(([name, content]) => appendDeflated(body, name, content));
  const properties = appendZip64Properties(body);
  const sheetData = deflateRawSync(realSheet);
  const sheetFields = deflatedFields(realSheet, sheetData);

  switch (copy) {
    case 'record-comment': {
      const sheet = appendEntry(body, SHEET_PART, sheetFields, sheetData);
      const comment = Buffer.concat([localHeader(SHEET_PART, sheetFields), sheetData]);
      const { file } = closeArchive(body, [...written, properties, { ...sheet, comment }]);
      return { file, realSheet };
    }
    case 'trailing-bytes': {
      const contentTypes = entries[CONTENT_TYPES_PART];
      if (contentTypes === undefined) throw new Error(`entry missing: ${CONTENT_TYPES_PART}`);
      const contentTypesData = deflateRawSync(contentTypes);
      const contentTypesFields = deflatedFields(contentTypes, contentTypesData);
      const sheetCopyFields: ZipFields = {
        ...sheetFields,
        compressedSize: sheetData.length + ZIP_SIGNATURE_LENGTH,
      };
      const data = Buffer.concat([
        contentTypesData,
        localHeader(CONTENT_TYPES_PART, contentTypesFields),
        contentTypesData,
        localHeader(SHEET_PART, sheetCopyFields),
        sheetData,
      ]);
      const contentTypesEntry = appendEntry(
        body,
        CONTENT_TYPES_PART,
        { ...contentTypesFields, compressedSize: data.length },
        data,
      );
      const sheet = appendEntry(body, SHEET_PART, sheetFields, sheetData);
      const { file } = closeArchive(body, [...written, properties, contentTypesEntry, sheet]);
      return { file, realSheet };
    }
    default: {
      const unhandled: never = copy;
      throw new Error(`Unhandled zip64 skip copy: ${String(unhandled)}`);
    }
  }
}

/** An unsigned data descriptor of `length` bytes: the crc, then both sizes. */
function unsignedDescriptor(fields: ZipFields, length: UnsignedDescriptorLength): Buffer {
  switch (length) {
    case UNSIGNED_DESCRIPTOR_32_LENGTH:
      return littleEndian([
        [fields.crc32, U32],
        [fields.compressedSize, U32],
        [fields.uncompressedSize, U32],
      ]);
    case UNSIGNED_DESCRIPTOR_64_LENGTH:
      // Each size in 64 bits: its 32-bit value, then a zero high half.
      return littleEndian([
        [fields.crc32, U32],
        [fields.compressedSize, U32],
        [ZIP_ZERO, U32],
        [fields.uncompressedSize, U32],
        [ZIP_ZERO, U32],
      ]);
    default: {
      const unhandled: never = length;
      throw new Error(`Unhandled unsigned descriptor length: ${String(unhandled)}`);
    }
  }
}

/**
 * The base workbook with its worksheet entry written with flag bit 3 (local crc and
 * sizes 0) and an unsigned data descriptor of `length` bytes that agrees with its
 * record; every other entry has no descriptor. Only the missing descriptor signature
 * sets it apart from an archive readZipLayout accepts.
 */
export function unsignedDescriptorArchive(length: UnsignedDescriptorLength): CraftedArchive {
  const { entries } = hiddenBase();
  const body = new ArchiveBody();
  const written = Object.entries(entries).map(([name, content]) => {
    if (name !== SHEET_PART) return appendDeflated(body, name, content);
    const data = deflateRawSync(content);
    const fields = bit3Fields(content, data);
    const headerOffset = body.append(localHeader(name, deferredFields(fields)));
    const dataOffset = body.append(data);
    body.append(unsignedDescriptor(fields, length));
    return { name, fields, headerOffset, dataOffset, segmentEnd: body.length };
  });
  return closeArchive(body, written);
}

// Crafted archives with a local header signature in the central directory. Past the
// last entry the gate's stream keeps searching for one, through the directory
// (Unzip.prototype.push in fflate). A signature whose header, name and extra field fit
// before the end of the file starts an entry the directory does not list; one whose
// name or extra field runs past the end makes the stream stop there and read nothing
// after it. Every entry has no data descriptor, and both archives pass today's gate.

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const CALC_CHAIN_PART = 'xl/calcChain.xml';
const CALC_CHAIN_RELATIONSHIP =
  '<Relationship Id="rIdCalcChain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>';
const CALC_CHAIN_OVERRIDE =
  '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>';
const CALC_CHAIN_XML = `${XML_DECLARATION}<calcChain xmlns="${MAIN_NAMESPACE}"><c r="B2" i="1"/></calcChain>`;
// Cell B2 holds the formula the calcChain names.
const FORMULA_SHEET_BODY =
  '<row r="1"><c r="A1"><v>1</v></c></row>' +
  '<row r="2"><c r="A2"><v>3</v></c><c r="B2"><f>1+1</f><v>2</v></c></row>';
const PLAIN_SHEET_BODY =
  '<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="A2"><v>2</v></c></row>';
const RELATIONSHIPS_END_TAG = '</Relationships>';
const TYPES_END_TAG = '</Types>';
const WORKSHEET_END_TAG = '</worksheet>';
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';
const COMMENT_FILLER = 'x';
// A central directory record without its name, extra field and comment.
const ZIP_RECORD_FIXED_LENGTH = 46;
// A name length no archive here has bytes left for after the header that declares it.
const UNREACHABLE_NAME_LENGTH = 0xffff;
// The values a 16-bit field can hold. A fake header in front of a record takes the low
// half of the record's 32-bit uncompressed size for its extra length.
const SIXTEEN_BIT_RANGE = 0x10000;
// The worksheet of sizeFlipArchive is this many bytes short of SIXTEEN_BIT_RANGE.
const SIZE_FLIP_HEADROOM = 6;
const SIZE_FLIP_SHEET_BYTES = SIXTEEN_BIT_RANGE - SIZE_FLIP_HEADROOM;

export interface DirectorySignatureArchive extends CraftedArchive {
  /** Offsets in `file` of the local header signatures planted in the directory. */
  readonly plantedSignatures: readonly number[];
}

/** `xml` with `child` inserted right before its last `endTag`. */
function insertBefore(xml: string, endTag: string, child: string): string {
  const at = xml.lastIndexOf(endTag);
  if (at === -1) throw new Error(`no ${endTag} to insert before`);
  return `${xml.slice(0, at)}${child}${xml.slice(at)}`;
}

function entryOf(entries: Readonly<Record<string, Uint8Array>>, name: string): Uint8Array {
  const bytes = entries[name];
  if (bytes === undefined) throw new Error(`entry missing: ${name}`);
  return bytes;
}

function layoutEntry(layout: ZipLayout, name: string): ZipEntry {
  const entry = layout.entries.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`entry missing from the layout: ${name}`);
  return entry;
}

/** The entries of a one-sheet workbook whose worksheet part is `sheetBytes`, in directory order. */
function workbookEntries(sheetBytes: Uint8Array): Record<string, Uint8Array> {
  const workbook = buildXlsxFixture([{ name: HIDDEN_SHEET_NAME, xml: strFromU8(sheetBytes) }]);
  return unzipSync(new Uint8Array(workbook));
}

/** A worksheet part of exactly `length` bytes: `body`, then a filler comment before the end tag. */
function paddedSheet(body: string, length: number): Uint8Array {
  const xml = strFromU8(sheet(body));
  const filler = length - xml.length - COMMENT_OPEN.length - COMMENT_CLOSE.length;
  const comment = `${COMMENT_OPEN}${COMMENT_FILLER.repeat(filler)}${COMMENT_CLOSE}`;
  const bytes = strToU8(insertBefore(xml, WORKSHEET_END_TAG, comment));
  if (bytes.length !== length) throw new Error(`the padded sheet has ${bytes.length} bytes`);
  return bytes;
}

/** A 30-byte local header with no name or extra bytes, whose name length is UNREACHABLE_NAME_LENGTH. */
function incompleteLocalHeader(): Buffer {
  return littleEndian([
    [ZIP_LOCAL_HEADER_SIGNATURE, U32],
    [ZIP_ZERO, U16], // version
    [ZIP_ZERO, U16], // flags
    [ZIP_ZERO, U16], // method
    [ZIP_ZERO, U16], // time
    [ZIP_ZERO, U16], // date
    [ZIP_ZERO, U32], // crc
    [ZIP_ZERO, U32], // compressed size
    [ZIP_ZERO, U32], // uncompressed size
    [UNREACHABLE_NAME_LENGTH, U16],
    [ZIP_ZERO, U16], // extra length
  ]);
}

/** Every entry of `contents`, in order, deflated without a data descriptor. */
function appendAll(body: ArchiveBody, contents: readonly [string, Uint8Array][]): WrittenEntry[] {
  return contents.map(([name, content]) => appendDeflated(body, name, content));
}

/**
 * The swallowed entry: a workbook whose cell B2 holds a formula that its calcChain
 * names. Two local header signatures sit in its directory:
 *   - the extra field of the calcChain record is a local header whose name length runs
 *     past the end of the file, so the stream stops there;
 *   - the comment of the docProps/app.xml record, which follows, is a complete local
 *     entry of xl/worksheets/sheet1.xml, which the stream therefore never reads.
 * Overwriting the formula of B2 drops the calcChain entry, its record and the header in
 * it: the stream of such an output reads the planted entry, a second worksheet entry of
 * that name, and the gate refuses it.
 */
export function swallowedEntryArchive(): DirectorySignatureArchive {
  const sheetBytes = sheet(FORMULA_SHEET_BODY);
  const workbook = workbookEntries(sheetBytes);
  const rels = strFromU8(entryOf(workbook, WORKBOOK_RELS_PART));
  const types = strFromU8(entryOf(workbook, CONTENT_TYPES_PART));
  // Spread first: the rels and the content types keep their place, the new parts follow.
  const contents: Record<string, Uint8Array> = {
    ...workbook,
    [WORKBOOK_RELS_PART]: strToU8(
      insertBefore(rels, RELATIONSHIPS_END_TAG, CALC_CHAIN_RELATIONSHIP),
    ),
    [CONTENT_TYPES_PART]: strToU8(insertBefore(types, TYPES_END_TAG, CALC_CHAIN_OVERRIDE)),
    [CALC_CHAIN_PART]: strToU8(CALC_CHAIN_XML),
    [HIDDEN_PROPERTIES_PART]: strToU8(HIDDEN_PROPERTIES),
  };
  const body = new ArchiveBody();
  const written = appendAll(body, Object.entries(contents));

  const sheetData = deflateRawSync(sheetBytes);
  const plantedEntry = Buffer.concat([
    localHeader(SHEET_PART, deflatedFields(sheetBytes, sheetData)),
    sheetData,
  ]);
  const directory = written.map((entry): WrittenEntry => {
    if (entry.name === CALC_CHAIN_PART) return { ...entry, extra: incompleteLocalHeader() };
    if (entry.name === HIDDEN_PROPERTIES_PART) return { ...entry, comment: plantedEntry };
    return entry;
  });
  const { file, layout } = closeArchive(body, directory);
  const calcChain = layoutEntry(layout, CALC_CHAIN_PART);
  const properties = layoutEntry(layout, HIDDEN_PROPERTIES_PART);
  return {
    file,
    layout,
    plantedSignatures: [
      calcChain.recordOffset + ZIP_RECORD_FIXED_LENGTH + Buffer.byteLength(CALC_CHAIN_PART),
      properties.recordOffset + properties.recordLength - plantedEntry.length,
    ],
  };
}

/**
 * The size flip: a one-sheet workbook with docProps/app.xml right before the worksheet,
 * in the body and in the directory. The comment of the docProps/app.xml record is a
 * bare local header signature, so the stream reads the worksheet's record behind it as
 * the rest of a local header, whose extra length is the low 16 bits of the worksheet's
 * uncompressed size. The worksheet is SIZE_FLIP_HEADROOM bytes short of 64 KiB, so that
 * length runs past the end of the file and the stream stops there. A patch that adds
 * more than SIZE_FLIP_HEADROOM bytes to the worksheet wraps those 16 bits to a small
 * number: the stream of such an output reads a complete entry there (its method is the
 * record's version, 20), and the gate refuses it.
 */
export function sizeFlipArchive(): DirectorySignatureArchive {
  const sheetBytes = paddedSheet(PLAIN_SHEET_BODY, SIZE_FLIP_SHEET_BYTES);
  const others = Object.entries(workbookEntries(sheetBytes)).filter(
    ([name]) => name !== SHEET_PART,
  );
  const body = new ArchiveBody();
  const written = appendAll(body, [
    ...others,
    [HIDDEN_PROPERTIES_PART, strToU8(HIDDEN_PROPERTIES)],
    [SHEET_PART, sheetBytes],
  ]);

  const signature = littleEndian([[ZIP_LOCAL_HEADER_SIGNATURE, U32]]);
  const directory = written.map(
    (entry): WrittenEntry =>
      entry.name === HIDDEN_PROPERTIES_PART ? { ...entry, comment: signature } : entry,
  );
  const { file, layout } = closeArchive(body, directory);
  const properties = layoutEntry(layout, HIDDEN_PROPERTIES_PART);
  return {
    file,
    layout,
    plantedSignatures: [properties.recordOffset + properties.recordLength - signature.length],
  };
}
