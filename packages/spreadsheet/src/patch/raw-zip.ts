import { Buffer } from 'node:buffer';
import { crc32, inflateRawSync } from 'node:zlib';
import { deflateSync, strFromU8 } from 'fflate';

import {
  MAX_DECOMPRESSED_BYTES,
  MAX_ERROR_CAUSE_LENGTH,
  MAX_ZIP_ENTRIES,
  PATCHED_PART_DEFLATE_LEVEL,
} from '../constants';
import { SpreadsheetFileError } from '../errors';
import { ZIP_REJECT_REASONS } from './reasons';

// The zip side of the export patch path: a strict reader of the archive's layout, the
// path's only inflate (bounded by the size an entry declares), and a writer that copies
// every unchanged entry as raw bytes.
//
// The import gate reads entries from the local-header stream (fflate's Unzip); the
// writer needs byte ranges, which only the central directory gives. readZipLayout
// accepts only an archive in which both walks visit the same entries at the same
// offsets: an end record at the very end with no comment, no zip64 structure, a
// directory that ends where the end record starts, entries that tile the bytes before
// the directory with no gap or overlap, local headers and data descriptors that agree
// with their records, and none of the signatures at which the stream ends an entry
// inside the segment of an entry that carries a data descriptor (flag bit 3).
//
// Nothing here inflates with fflate: its sync inflate and unzip decode a deflate stream
// to its end and drop the overflow, whatever size the directory declares.

/** One entry of the archive, on which its directory record and local header agree. */
export interface ZipEntry {
  /** fflate's own strFromU8(nameBytes, !utf8Flag): the string the gate's stream gave this name. */
  readonly name: string;
  readonly flags: number;
  /** 0 (stored) or 8 (deflated). */
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  /** Offset of the local header. */
  readonly headerOffset: number;
  /** Offset of the first compressed byte. */
  readonly dataOffset: number;
  /** Just past the data, or past its data descriptor. */
  readonly segmentEnd: number;
  /** Offset of the central directory record. */
  readonly recordOffset: number;
  readonly recordLength: number;
}

export interface ZipLayout {
  /** In central directory order. */
  readonly entries: readonly ZipEntry[];
  readonly directoryOffset: number;
  readonly endRecordOffset: number;
}

export type ZipChange =
  | { readonly kind: 'replace'; readonly content: Uint8Array }
  | { readonly kind: 'drop' };

type ZipRejectReason = (typeof ZIP_REJECT_REASONS)[keyof typeof ZIP_REJECT_REASONS];

const LITTLE_ENDIAN = true;
// Widths in bytes of the zip fields.
const U16_WIDTH = 2;
const U32_WIDTH = 4;
const U64_WIDTH = 8;

// Signatures, as little-endian 32-bit numbers.
const LOCAL_HEADER_SIGNATURE = 0x04034b50; // 'PK\x03\x04'
const DIRECTORY_RECORD_SIGNATURE = 0x02014b50; // 'PK\x01\x02'
const END_RECORD_SIGNATURE = 0x06054b50; // 'PK\x05\x06'
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50; // 'PK\x07\x08'
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50; // 'PK\x06\x07'
const SIGNATURE_LENGTH = U32_WIDTH;

// End of central directory record: fixed length, no comment accepted.
const END_RECORD_LENGTH = 22;
const END_DISK = 4;
const END_DIRECTORY_DISK = 6;
const END_DISK_ENTRIES = 8;
const END_TOTAL_ENTRIES = 10;
const END_DIRECTORY_SIZE = 12;
const END_DIRECTORY_OFFSET = 16;
const END_COMMENT_LENGTH = 20;
// The zip64 end of central directory locator sits right before the end record.
const ZIP64_LOCATOR_LENGTH = 20;

// Central directory record: fixed part, then name, extra field and comment.
const RECORD_FIXED_LENGTH = 46;
const RECORD_VERSION_NEEDED = 6;
const RECORD_FLAGS = 8;
const RECORD_METHOD = 10;
const RECORD_CRC = 16;
const RECORD_COMPRESSED_SIZE = 20;
const RECORD_UNCOMPRESSED_SIZE = 24;
const RECORD_NAME_LENGTH = 28;
const RECORD_EXTRA_LENGTH = 30;
const RECORD_COMMENT_LENGTH = 32;
const RECORD_DISK = 34;
const RECORD_HEADER_OFFSET = 42;

// Local file header: fixed part, then name and extra field.
const LOCAL_HEADER_LENGTH = 30;
const LOCAL_VERSION_NEEDED = 4;
const LOCAL_FLAGS = 6;
const LOCAL_METHOD = 8;
const LOCAL_TIME = 10;
const LOCAL_DATE = 12;
const LOCAL_CRC = 14;
const LOCAL_COMPRESSED_SIZE = 18;
const LOCAL_UNCOMPRESSED_SIZE = 22;
const LOCAL_NAME_LENGTH = 26;
const LOCAL_EXTRA_LENGTH = 28;

// General purpose flag bits.
const FLAG_ENCRYPTED = 0x0001; // bit 0
const FLAG_DATA_DESCRIPTOR = 0x0008; // bit 3
const FLAG_STRONG_ENCRYPTION = 0x0040; // bit 6
const FLAG_UTF8 = 0x0800; // bit 11
const FLAG_MASKED_HEADER = 0x2000; // bit 13: the directory is encrypted
const ENCRYPTION_FLAGS = FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION | FLAG_MASKED_HEADER;
// The bits a local header must share with its record.
const MATCHED_FLAGS = ENCRYPTION_FLAGS | FLAG_DATA_DESCRIPTOR | FLAG_UTF8;

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
// Version needed to extract a deflated entry, written into a replaced entry's headers.
const VERSION_NEEDED_DEFLATE = 20;
// A 16-bit count or a 32-bit size or offset at its maximum defers to a zip64 structure.
const ZIP64_COUNT = 0xffff;
const ZIP64_FIELD = 0xffffffff;
const SINGLE_DISK = 0;
const NO_COMMENT = 0;
const NO_EXTRA_FIELD = 0;
const NO_TAIL = 0;
const NO_SIGNATURE = 0;
const FILE_START = 0;
const NOT_FOUND = -1;
// inflateRawSync's maxOutputLength must be at least 1.
const MIN_MAX_OUTPUT_LENGTH = 1;

/** A data descriptor: optional signature, then the crc and two sizes of 32 or 64 bits. */
interface DescriptorForm {
  readonly signed: boolean;
  readonly sizeWidth: number;
}

const DESCRIPTOR_FORMS: readonly DescriptorForm[] = [
  { signed: false, sizeWidth: U32_WIDTH },
  { signed: true, sizeWidth: U32_WIDTH },
  { signed: false, sizeWidth: U64_WIDTH },
  { signed: true, sizeWidth: U64_WIDTH },
];

function descriptorLength(form: DescriptorForm): number {
  const signature = form.signed ? SIGNATURE_LENGTH : NO_SIGNATURE;
  return signature + U32_WIDTH + form.sizeWidth + form.sizeWidth;
}

// 12, 16, 20 and 24 bytes.
const DESCRIPTOR_FORM_BY_LENGTH: ReadonlyMap<number, DescriptorForm> = new Map(
  DESCRIPTOR_FORMS.map((form): [number, DescriptorForm] => [descriptorLength(form), form]),
);

function signatureBytes(signature: number): Buffer {
  const bytes = Buffer.alloc(SIGNATURE_LENGTH);
  bytes.writeUInt32LE(signature, 0);
  return bytes;
}

const LOCAL_HEADER_SIGNATURE_BYTES = signatureBytes(LOCAL_HEADER_SIGNATURE);
const DATA_DESCRIPTOR_SIGNATURE_BYTES = signatureBytes(DATA_DESCRIPTOR_SIGNATURE);
const DIRECTORY_RECORD_SIGNATURE_BYTES = signatureBytes(DIRECTORY_RECORD_SIGNATURE);
// The signatures at which fflate's stream ends the data of a bit-3 entry, wherever
// they stand (Unzip.prototype.push).
const STREAM_STOP_SIGNATURES: readonly Buffer[] = [
  LOCAL_HEADER_SIGNATURE_BYTES,
  DATA_DESCRIPTOR_SIGNATURE_BYTES,
  DIRECTORY_RECORD_SIGNATURE_BYTES,
];

/** What readZipLayout keeps of the end record. */
interface EndRecord {
  readonly endRecordOffset: number;
  readonly directoryOffset: number;
  readonly count: number;
}

/** A central directory record; its name bytes stay in the file. */
interface DirectoryRecord {
  /** Position in the directory. */
  readonly index: number;
  readonly name: string;
  readonly nameOffset: number;
  readonly nameLength: number;
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly headerOffset: number;
  readonly recordOffset: number;
  readonly recordLength: number;
}

function zipError(reason: ZipRejectReason, message: string, entry?: string): SpreadsheetFileError {
  const meta: Record<string, unknown> =
    entry === undefined ? { reason } : { reason, entry: entry.slice(0, MAX_ERROR_CAUSE_LENGTH) };
  return new SpreadsheetFileError('CORRUPT_FILE', message, meta);
}

function layoutError(message: string, entry?: string): SpreadsheetFileError {
  return zipError(ZIP_REJECT_REASONS.LAYOUT, message, entry);
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function u16(view: DataView, at: number): number {
  return view.getUint16(at, LITTLE_ENDIAN);
}

function u32(view: DataView, at: number): number {
  return view.getUint32(at, LITTLE_ENDIAN);
}

/** zip-layout unless `length` bytes from `at` end at or before `limit`. */
function requireBytes(at: number, length: number, limit: number, entry?: string): void {
  if (at + length > limit) throw layoutError('Zip structure runs past its bounds', entry);
}

function hasZip64Locator(view: DataView, endRecordOffset: number): boolean {
  const at = endRecordOffset - ZIP64_LOCATOR_LENGTH;
  return at >= FILE_START && u32(view, at) === ZIP64_LOCATOR_SIGNATURE;
}

/**
 * The end record: the last END_RECORD_LENGTH bytes, with no comment, one disk, one
 * entry count of at most MAX_ZIP_ENTRIES, and a directory that ends where it starts.
 */
function readEndRecord(view: DataView): EndRecord {
  const endRecordOffset = view.byteLength - END_RECORD_LENGTH;
  if (endRecordOffset < FILE_START || u32(view, endRecordOffset) !== END_RECORD_SIGNATURE) {
    throw layoutError('Zip end record is not the last bytes of the file');
  }
  if (u16(view, endRecordOffset + END_COMMENT_LENGTH) !== NO_COMMENT) {
    throw layoutError('Zip archive carries a comment');
  }
  const diskEntries = u16(view, endRecordOffset + END_DISK_ENTRIES);
  const count = u16(view, endRecordOffset + END_TOTAL_ENTRIES);
  const directorySize = u32(view, endRecordOffset + END_DIRECTORY_SIZE);
  const directoryOffset = u32(view, endRecordOffset + END_DIRECTORY_OFFSET);
  if (
    diskEntries === ZIP64_COUNT ||
    count === ZIP64_COUNT ||
    directorySize === ZIP64_FIELD ||
    directoryOffset === ZIP64_FIELD ||
    hasZip64Locator(view, endRecordOffset)
  ) {
    throw zipError(ZIP_REJECT_REASONS.ZIP64, 'Zip archive uses zip64 structures');
  }
  if (
    u16(view, endRecordOffset + END_DISK) !== SINGLE_DISK ||
    u16(view, endRecordOffset + END_DIRECTORY_DISK) !== SINGLE_DISK
  ) {
    throw layoutError('Zip archive spans several disks');
  }
  if (diskEntries !== count || count > MAX_ZIP_ENTRIES) {
    throw layoutError('Zip end record declares an entry count it cannot have');
  }
  if (directoryOffset + directorySize !== endRecordOffset) {
    throw layoutError('Zip directory does not end where the end record starts');
  }
  return { endRecordOffset, directoryOffset, count };
}

/** Encryption, an unknown method, a zip64 field or another disk refuse a record. */
function assertSupportedRecord(view: DataView, record: DirectoryRecord): void {
  const { name } = record;
  if ((record.flags & ENCRYPTION_FLAGS) !== 0) {
    throw zipError(ZIP_REJECT_REASONS.ENCRYPTED, 'Zip entry is encrypted', name);
  }
  if (record.method !== METHOD_STORED && record.method !== METHOD_DEFLATED) {
    throw zipError(ZIP_REJECT_REASONS.METHOD, 'Zip entry uses an unsupported method', name);
  }
  if (
    record.compressedSize === ZIP64_FIELD ||
    record.uncompressedSize === ZIP64_FIELD ||
    record.headerOffset === ZIP64_FIELD
  ) {
    throw zipError(ZIP_REJECT_REASONS.ZIP64, 'Zip entry defers a field to zip64', name);
  }
  if (u16(view, record.recordOffset + RECORD_DISK) !== SINGLE_DISK) {
    throw layoutError('Zip entry starts on another disk', name);
  }
}

/** Exactly `end.count` records from the directory offset to the end record, names unique. */
function readRecords(file: Uint8Array, view: DataView, end: EndRecord): DirectoryRecord[] {
  const records: DirectoryRecord[] = [];
  const names = new Set<string>();
  let at = end.directoryOffset;
  for (let index = 0; index < end.count; index += 1) {
    requireBytes(at, RECORD_FIXED_LENGTH, end.endRecordOffset);
    if (u32(view, at) !== DIRECTORY_RECORD_SIGNATURE) {
      throw layoutError('Zip directory record has no signature');
    }
    const nameLength = u16(view, at + RECORD_NAME_LENGTH);
    const recordLength =
      RECORD_FIXED_LENGTH +
      nameLength +
      u16(view, at + RECORD_EXTRA_LENGTH) +
      u16(view, at + RECORD_COMMENT_LENGTH);
    requireBytes(at, recordLength, end.endRecordOffset);
    const flags = u16(view, at + RECORD_FLAGS);
    const nameOffset = at + RECORD_FIXED_LENGTH;
    // Decoded as fflate's stream and its sync unzip decode it (its TextDecoder strips a
    // leading byte order mark), so the name equals the gate's key for the part.
    const latin1 = (flags & FLAG_UTF8) === 0;
    const name = strFromU8(file.subarray(nameOffset, nameOffset + nameLength), latin1);
    const record: DirectoryRecord = {
      index,
      name,
      nameOffset,
      nameLength,
      flags,
      method: u16(view, at + RECORD_METHOD),
      crc32: u32(view, at + RECORD_CRC),
      compressedSize: u32(view, at + RECORD_COMPRESSED_SIZE),
      uncompressedSize: u32(view, at + RECORD_UNCOMPRESSED_SIZE),
      headerOffset: u32(view, at + RECORD_HEADER_OFFSET),
      recordOffset: at,
      recordLength,
    };
    assertSupportedRecord(view, record);
    if (names.has(name)) throw layoutError('Zip directory repeats an entry name', name);
    names.add(name);
    records.push(record);
    at += recordLength;
  }
  if (at !== end.endRecordOffset) {
    throw layoutError('Zip directory does not end at the end record');
  }
  return records;
}

function sameBytes(file: Uint8Array, a: number, b: number, length: number): boolean {
  for (let i = 0; i < length; i += 1) {
    if (file[a + i] !== file[b + i]) return false;
  }
  return true;
}

/** Without bit 3: nothing after the data, and the local crc and sizes are the record's. */
function assertLocalSizes(view: DataView, record: DirectoryRecord, tail: number): void {
  const at = record.headerOffset;
  if (tail !== NO_TAIL) {
    throw layoutError('Zip entry is followed by bytes no entry covers', record.name);
  }
  if (
    u32(view, at + LOCAL_CRC) !== record.crc32 ||
    u32(view, at + LOCAL_COMPRESSED_SIZE) !== record.compressedSize ||
    u32(view, at + LOCAL_UNCOMPRESSED_SIZE) !== record.uncompressedSize
  ) {
    throw layoutError('Zip local header declares another crc or size', record.name);
  }
}

/** Whether the size at `at` (32 bits, or 64 with a zero high half) is `expected`. */
function sizeEquals(view: DataView, at: number, width: number, expected: number): boolean {
  if (width === U64_WIDTH && u32(view, at + U32_WIDTH) !== 0) return false;
  return u32(view, at) === expected;
}

/**
 * With bit 3: the `tail` bytes after the data are one data descriptor (12, 16, 20 or
 * 24 bytes) whose crc and sizes are the record's.
 */
function assertDataDescriptor(
  view: DataView,
  record: DirectoryRecord,
  dataEnd: number,
  tail: number,
): DescriptorForm {
  const form = DESCRIPTOR_FORM_BY_LENGTH.get(tail);
  if (form === undefined) {
    throw layoutError('Zip data descriptor has no valid length', record.name);
  }
  let at = dataEnd;
  if (form.signed) {
    if (u32(view, at) !== DATA_DESCRIPTOR_SIGNATURE) {
      throw layoutError('Zip data descriptor has no signature', record.name);
    }
    at += SIGNATURE_LENGTH;
  }
  const crcMatches = u32(view, at) === record.crc32;
  at += U32_WIDTH;
  const compressedMatches = sizeEquals(view, at, form.sizeWidth, record.compressedSize);
  at += form.sizeWidth;
  const uncompressedMatches = sizeEquals(view, at, form.sizeWidth, record.uncompressedSize);
  if (!crcMatches || !compressedMatches || !uncompressedMatches) {
    throw layoutError('Zip data descriptor disagrees with its record', record.name);
  }
  return form;
}

/**
 * With bit 3, the signature rule: no STREAM_STOP_SIGNATURES in the segment
 * [dataOffset, segmentEnd) but the descriptor's own signature, right after the data in
 * the signed forms. The stream would end the entry at any other one, so the directory
 * and the stream would read different entries from here on. Each signature is searched
 * in the segment only, at most twice; nothing is copied or inflated.
 */
function assertNoStreamStop(
  file: Uint8Array,
  record: DirectoryRecord,
  dataOffset: number,
  segmentEnd: number,
  form: DescriptorForm,
): void {
  const segment = Buffer.from(file.buffer, file.byteOffset + dataOffset, segmentEnd - dataOffset);
  const ownSignature = form.signed ? record.compressedSize : NOT_FOUND;
  for (const signature of STREAM_STOP_SIGNATURES) {
    let hit = segment.indexOf(signature);
    if (signature === DATA_DESCRIPTOR_SIGNATURE_BYTES && hit === ownSignature) {
      hit = segment.indexOf(signature, hit + 1);
    }
    if (hit !== NOT_FOUND) {
      throw layoutError('Zip entry with a data descriptor holds a zip signature', record.name);
    }
  }
}

/**
 * The entry of `record`, whose segment runs from its local header to `segmentEnd` (the
 * next entry's header, or the directory). Cheap header checks first, then the data
 * descriptor, then the signature search.
 */
function readEntry(
  file: Uint8Array,
  view: DataView,
  record: DirectoryRecord,
  segmentEnd: number,
): ZipEntry {
  const { name } = record;
  const at = record.headerOffset;
  requireBytes(at, LOCAL_HEADER_LENGTH, segmentEnd, name);
  if (u32(view, at) !== LOCAL_HEADER_SIGNATURE) {
    throw layoutError('Zip entry has no local header', name);
  }
  const nameLength = u16(view, at + LOCAL_NAME_LENGTH);
  const dataOffset = at + LOCAL_HEADER_LENGTH + nameLength + u16(view, at + LOCAL_EXTRA_LENGTH);
  const dataEnd = dataOffset + record.compressedSize;
  // Also bounds the local name: it lies between the header and the data.
  if (dataEnd > segmentEnd) throw layoutError('Zip entry overlaps the next one', name);
  if (
    nameLength !== record.nameLength ||
    !sameBytes(file, at + LOCAL_HEADER_LENGTH, record.nameOffset, nameLength)
  ) {
    throw layoutError('Zip local header names another entry', name);
  }
  if (
    u16(view, at + LOCAL_METHOD) !== record.method ||
    (u16(view, at + LOCAL_FLAGS) & MATCHED_FLAGS) !== (record.flags & MATCHED_FLAGS)
  ) {
    throw layoutError('Zip local header disagrees with its record', name);
  }
  if (record.method === METHOD_STORED && record.compressedSize !== record.uncompressedSize) {
    throw layoutError('Stored zip entry declares two sizes', name);
  }
  const tail = segmentEnd - dataEnd;
  if ((record.flags & FLAG_DATA_DESCRIPTOR) === 0) {
    assertLocalSizes(view, record, tail);
  } else {
    const form = assertDataDescriptor(view, record, dataEnd, tail);
    assertNoStreamStop(file, record, dataOffset, segmentEnd, form);
  }
  return {
    name,
    flags: record.flags,
    method: record.method,
    crc32: record.crc32,
    compressedSize: record.compressedSize,
    uncompressedSize: record.uncompressedSize,
    headerOffset: at,
    dataOffset,
    segmentEnd,
    recordOffset: record.recordOffset,
    recordLength: record.recordLength,
  };
}

/**
 * The entries sorted by local header offset tile [0, directoryOffset): the first starts
 * at 0, each one's segment ends where the next begins, and the last ends at the
 * directory. Returned in directory order.
 */
function tileEntries(
  file: Uint8Array,
  view: DataView,
  end: EndRecord,
  records: readonly DirectoryRecord[],
): ZipEntry[] {
  const physical = [...records].sort((a, b) => a.headerOffset - b.headerOffset);
  // Filled at each record's directory index; every index is written once.
  const entries = new Array<ZipEntry>(records.length);
  let segmentStart = FILE_START;
  for (const [position, record] of physical.entries()) {
    if (record.headerOffset !== segmentStart) {
      throw layoutError('Zip entries leave a gap or overlap', record.name);
    }
    const segmentEnd = physical[position + 1]?.headerOffset ?? end.directoryOffset;
    if (segmentEnd > end.directoryOffset) {
      throw layoutError('Zip entry starts inside the directory', record.name);
    }
    entries[record.index] = readEntry(file, view, record, segmentEnd);
    segmentStart = segmentEnd;
  }
  if (segmentStart !== end.directoryOffset) {
    throw layoutError('Zip entries do not reach the directory');
  }
  return entries;
}

/**
 * The layout of a zip archive, in the only shape the export patch path accepts (see
 * the top of this file). Throws CORRUPT_FILE with `meta.reason` (`zip-layout`,
 * `zip64`, `zip-encrypted`, `zip-method`) and, when the fault lies in one entry, its
 * name in `meta.entry`. Every read is bounds-checked; nothing is inflated or copied.
 */
export function readZipLayout(file: Uint8Array): ZipLayout {
  const view = viewOf(file);
  const end = readEndRecord(view);
  const records = readRecords(file, view, end);
  const entries = tileEntries(file, view, end, records);
  return { entries, directoryOffset: end.directoryOffset, endRecordOffset: end.endRecordOffset };
}

function viewMismatch(entry: ZipEntry): SpreadsheetFileError {
  return zipError(
    ZIP_REJECT_REASONS.VIEW_MISMATCH,
    'Zip entry does not inflate to its declared size',
    entry.name,
  );
}

function inflateBounded(raw: Uint8Array, entry: ZipEntry): Uint8Array {
  try {
    // zlib stops with ERR_BUFFER_TOO_LARGE as soon as the output would pass the bound.
    return inflateRawSync(raw, {
      maxOutputLength: Math.max(entry.uncompressedSize, MIN_MAX_OUTPUT_LENGTH),
    });
  } catch {
    // Overflow, bad data or a stream that ends early: the gate proved that the stream's
    // entry of this name inflates to exactly the declared size, so this is not it.
    throw viewMismatch(entry);
  }
}

/** The entry's content: a view for a stored entry; a deflated one inflated with its declared size as a hard output bound. */
export function entryContent(file: Uint8Array, entry: ZipEntry): Uint8Array {
  if (entry.uncompressedSize > MAX_DECOMPRESSED_BYTES) {
    throw layoutError('Zip entry declares more than the decompression cap', entry.name);
  }
  const raw = file.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let content: Uint8Array;
  if (entry.method === METHOD_STORED) {
    content = raw;
  } else if (entry.method === METHOD_DEFLATED) {
    content = inflateBounded(raw, entry);
  } else {
    throw zipError(ZIP_REJECT_REASONS.METHOD, 'Zip entry uses an unsupported method', entry.name);
  }
  if (content.length !== entry.uncompressedSize) throw viewMismatch(entry);
  return content;
}

/** What rewriteZip writes for one entry. */
type EntryPlan =
  | { readonly kind: 'copy' }
  | { readonly kind: 'drop' }
  | {
      readonly kind: 'replace';
      readonly content: Uint8Array;
      readonly data: Uint8Array;
      readonly crc32: number;
    };

interface PlannedEntry {
  readonly entry: ZipEntry;
  readonly plan: EntryPlan;
  readonly nameLength: number;
  /** Offset of its local header in the new archive. */
  headerOffset: number;
}

const COPY_PLAN: EntryPlan = { kind: 'copy' };

function planOf(change: ZipChange | undefined): EntryPlan {
  if (change === undefined) return COPY_PLAN;
  switch (change.kind) {
    case 'drop':
      return change;
    case 'replace':
      return {
        kind: 'replace',
        content: change.content,
        data: deflateSync(change.content, { level: PATCHED_PART_DEFLATE_LEVEL }),
        crc32: crc32(change.content),
      };
    default: {
      const unhandled: never = change;
      throw new Error(`Unhandled zip change: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Bytes the entry takes before the new directory. */
function segmentLength(planned: PlannedEntry): number {
  const { entry, plan } = planned;
  switch (plan.kind) {
    case 'copy':
      return entry.segmentEnd - entry.headerOffset;
    case 'drop':
      return 0;
    case 'replace':
      return LOCAL_HEADER_LENGTH + planned.nameLength + plan.data.length;
    default: {
      const unhandled: never = plan;
      throw new Error(`Unhandled zip entry plan: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * A new local header (no data descriptor: version 20, the original's bit 11 only,
 * deflated, the original's time and date, real crc and sizes, no extra field), the
 * original name bytes, then the new data.
 */
function writeReplacedSegment(
  file: Uint8Array,
  out: Uint8Array,
  view: DataView,
  planned: PlannedEntry,
  plan: Extract<EntryPlan, { readonly kind: 'replace' }>,
): void {
  const at = planned.headerOffset;
  const source = planned.entry.headerOffset;
  view.setUint32(at, LOCAL_HEADER_SIGNATURE, LITTLE_ENDIAN);
  view.setUint16(at + LOCAL_VERSION_NEEDED, VERSION_NEEDED_DEFLATE, LITTLE_ENDIAN);
  view.setUint16(at + LOCAL_FLAGS, planned.entry.flags & FLAG_UTF8, LITTLE_ENDIAN);
  view.setUint16(at + LOCAL_METHOD, METHOD_DEFLATED, LITTLE_ENDIAN);
  out.set(file.subarray(source + LOCAL_TIME, source + LOCAL_DATE + U16_WIDTH), at + LOCAL_TIME);
  view.setUint32(at + LOCAL_CRC, plan.crc32, LITTLE_ENDIAN);
  view.setUint32(at + LOCAL_COMPRESSED_SIZE, plan.data.length, LITTLE_ENDIAN);
  view.setUint32(at + LOCAL_UNCOMPRESSED_SIZE, plan.content.length, LITTLE_ENDIAN);
  view.setUint16(at + LOCAL_NAME_LENGTH, planned.nameLength, LITTLE_ENDIAN);
  view.setUint16(at + LOCAL_EXTRA_LENGTH, NO_EXTRA_FIELD, LITTLE_ENDIAN);
  const name = source + LOCAL_HEADER_LENGTH;
  out.set(file.subarray(name, name + planned.nameLength), at + LOCAL_HEADER_LENGTH);
  out.set(plan.data, at + LOCAL_HEADER_LENGTH + planned.nameLength);
}

function writeSegment(
  file: Uint8Array,
  out: Uint8Array,
  view: DataView,
  planned: PlannedEntry,
): void {
  const { entry, plan } = planned;
  switch (plan.kind) {
    case 'copy':
      // Local header, data and data descriptor as they are.
      out.set(file.subarray(entry.headerOffset, entry.segmentEnd), planned.headerOffset);
      return;
    case 'drop':
      return;
    case 'replace':
      writeReplacedSegment(file, out, view, planned, plan);
      return;
    default: {
      const unhandled: never = plan;
      throw new Error(`Unhandled zip entry plan: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The original record with its local header offset rewritten; for a replaced entry
 * also the version needed, flags, method, crc and both sizes. Name, extra field,
 * comment, attributes and times stay as they are.
 */
function writeRecord(
  file: Uint8Array,
  out: Uint8Array,
  view: DataView,
  planned: PlannedEntry,
  at: number,
): void {
  const { entry, plan } = planned;
  out.set(file.subarray(entry.recordOffset, entry.recordOffset + entry.recordLength), at);
  view.setUint32(at + RECORD_HEADER_OFFSET, planned.headerOffset, LITTLE_ENDIAN);
  if (plan.kind !== 'replace') return;
  view.setUint16(at + RECORD_VERSION_NEEDED, VERSION_NEEDED_DEFLATE, LITTLE_ENDIAN);
  view.setUint16(at + RECORD_FLAGS, entry.flags & FLAG_UTF8, LITTLE_ENDIAN);
  view.setUint16(at + RECORD_METHOD, METHOD_DEFLATED, LITTLE_ENDIAN);
  view.setUint32(at + RECORD_CRC, plan.crc32, LITTLE_ENDIAN);
  view.setUint32(at + RECORD_COMPRESSED_SIZE, plan.data.length, LITTLE_ENDIAN);
  view.setUint32(at + RECORD_UNCOMPRESSED_SIZE, plan.content.length, LITTLE_ENDIAN);
}

/** The new directory's place and size. */
interface NewDirectory {
  readonly count: number;
  readonly offset: number;
  readonly size: number;
}

/** The original end record with both entry counts, the directory size and offset rewritten. */
function writeEndRecord(
  file: Uint8Array,
  out: Uint8Array,
  view: DataView,
  layout: ZipLayout,
  directory: NewDirectory,
): void {
  const at = directory.offset + directory.size;
  const source = layout.endRecordOffset;
  out.set(file.subarray(source, source + END_RECORD_LENGTH), at);
  view.setUint16(at + END_DISK_ENTRIES, directory.count, LITTLE_ENDIAN);
  view.setUint16(at + END_TOTAL_ENTRIES, directory.count, LITTLE_ENDIAN);
  view.setUint32(at + END_DIRECTORY_SIZE, directory.size, LITTLE_ENDIAN);
  view.setUint32(at + END_DIRECTORY_OFFSET, directory.offset, LITTLE_ENDIAN);
}

/** A new archive: unchanged entries as raw bytes, `changes` applied by entry name. */
export function rewriteZip(
  file: Uint8Array,
  layout: ZipLayout,
  changes: ReadonlyMap<string, ZipChange>,
): Uint8Array<ArrayBuffer> {
  const names = new Set(layout.entries.map((entry) => entry.name));
  for (const name of changes.keys()) {
    if (!names.has(name)) {
      throw new Error(
        `Zip rewrite changes an entry the archive does not have: ${name.slice(0, MAX_ERROR_CAUSE_LENGTH)}`,
      );
    }
  }

  const fileView = viewOf(file);
  const planned: PlannedEntry[] = layout.entries.map((entry) => ({
    entry,
    plan: planOf(changes.get(entry.name)),
    nameLength: u16(fileView, entry.headerOffset + LOCAL_NAME_LENGTH),
    headerOffset: FILE_START,
  }));

  // Every size is known before the one allocation: the local segments in physical
  // order, then the kept records in directory order, then the end record.
  const physical = [...planned].sort((a, b) => a.entry.headerOffset - b.entry.headerOffset);
  let directoryOffset = FILE_START;
  for (const item of physical) {
    item.headerOffset = directoryOffset;
    directoryOffset += segmentLength(item);
  }
  const kept = planned.filter((item) => item.plan.kind !== 'drop');
  const directorySize = kept.reduce((size, item) => size + item.entry.recordLength, 0);

  const out = new Uint8Array(directoryOffset + directorySize + END_RECORD_LENGTH);
  const view = new DataView(out.buffer);
  for (const item of physical) writeSegment(file, out, view, item);
  let at = directoryOffset;
  for (const item of kept) {
    writeRecord(file, out, view, item, at);
    at += item.entry.recordLength;
  }
  writeEndRecord(file, out, view, layout, {
    count: kept.length,
    offset: directoryOffset,
    size: directorySize,
  });
  return out;
}
