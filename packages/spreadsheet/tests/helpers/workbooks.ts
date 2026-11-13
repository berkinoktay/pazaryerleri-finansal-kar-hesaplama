import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { crc32, deflateRawSync } from 'node:zlib';

import type { ZipEntry, ZipLayout } from '../../src/patch/raw-zip';
import { buildXlsxFixture, worksheetXml } from '../../src/testing/build-xlsx';
import { readFixture } from './fixture-pins';

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

// Crafted archives of the zip layout tests: a central directory that reads another
// worksheet than the local-header stream does. Both are written by hand: local headers
// of 30 bytes plus the name (version 20), directory records of 46 bytes plus the name,
// a 22-byte end record; no extra field, no comment, time and date zero.

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

function localHeader(name: string, fields: ZipFields): Buffer {
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
    [ZIP_ZERO, U16], // extra length
  ]);
  return Buffer.concat([header, nameBytes]);
}

function directoryRecord(entry: WrittenEntry): Buffer {
  const nameBytes = Buffer.from(entry.name);
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
    [ZIP_ZERO, U16], // extra length
    [ZIP_ZERO, U16], // comment length
    [ZIP_ZERO, U16], // disk number
    [ZIP_ZERO, U16], // internal attributes
    [ZIP_ZERO, U32], // external attributes
    [entry.headerOffset, U32],
  ]);
  return Buffer.concat([record, nameBytes]);
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

/** Appends a local header without a data descriptor, then the deflated `content`. */
function appendDeflated(body: ArchiveBody, name: string, content: Uint8Array): WrittenEntry {
  const data = deflateRawSync(content);
  const fields = deflatedFields(content, data);
  const headerOffset = body.append(localHeader(name, fields));
  const dataOffset = body.append(data);
  return { name, fields, headerOffset, dataOffset, segmentEnd: body.length };
}

/** `body`, then a directory record per entry of `entries` in that order, then the end record. */
function closeArchive(
  body: ArchiveBody,
  entries: readonly WrittenEntry[],
): { readonly file: Buffer; readonly layout: ZipLayout } {
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
