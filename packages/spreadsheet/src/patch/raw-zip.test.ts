import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../../tests/helpers/errors';
import { FIXTURE_PINS, readFixture } from '../../tests/helpers/fixture-pins';
import { BOUNDED_INFLATE_BUDGET_MS, expectWithinBudget } from '../../tests/helpers/timing';
import {
  type DirectorySignatureArchive,
  hiddenEntryArchive,
  hiddenTileArchive,
  type HiddenTileKind,
  rawSegment,
  sizeFlipArchive,
  swallowedEntryArchive,
  unsignedDescriptorArchive,
  type UnsignedDescriptorLength,
  zip64SkipArchive,
  type Zip64SkipCopy,
} from '../../tests/helpers/workbooks';
import {
  DEFAULT_COL_CAP,
  DEFAULT_MAX_BYTES,
  DEFAULT_ROW_CAP,
  MAX_DECOMPRESSED_BYTES,
  MAX_ERROR_CAUSE_LENGTH,
  MAX_ZIP_ENTRIES,
} from '../constants';
import { SpreadsheetFileError } from '../errors';
import { openUpload } from '../guards';
import { buildXlsxFixture, worksheetXml } from '../testing/build-xlsx';
import {
  type DeflatedContent,
  entryContent,
  readZipLayout,
  rewriteZip,
  type ZipChange,
  type ZipEntry,
  type ZipLayout,
} from './raw-zip';
import { ZIP_REJECT_REASONS } from './reasons';

const SHEET_PART = 'xl/worksheets/sheet1.xml';
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const APP_PROPERTIES_PART = 'docProps/app.xml';
// Every entry carries flag bit 3 and a 16-byte data descriptor.
const COMMISSION_FIXTURE = 'trendyol-commission-tariff.xlsx';
// No entry carries flag bit 3.
const ONE_PERIOD_FIXTURE = 'trendyol-tariff-1period.xlsx';
// Entries of each fixture, in FIXTURE_PINS order.
const FIXTURE_ENTRY_COUNTS: readonly number[] = [9, 10, 9, 9, 8, 9, 9, 9];
// The data descriptor length of every entry of each fixture (0: none), in FIXTURE_PINS order.
const FIXTURE_DESCRIPTOR_LENGTHS: readonly number[] = [16, 0, 24, 24, 16, 24, 16, 24];
const GUARD_OPTS = {
  rowCap: DEFAULT_ROW_CAP,
  colCap: DEFAULT_COL_CAP,
  maxBytes: DEFAULT_MAX_BYTES,
} as const;
const PROBE = '<!--probe-->';
const WORKSHEET_END_TAG = '</worksheet>';
const TILE_KINDS: readonly HiddenTileKind[] = ['other-sheet', 'bomb', 'same-sheet'];
const ZIP64_SKIP_COPIES: readonly Zip64SkipCopy[] = ['record-comment', 'trailing-bytes'];
const UNSIGNED_DESCRIPTOR_LENGTHS: readonly UnsignedDescriptorLength[] = [12, 20];
// A compressed size that runs far past the end of any fixture.
const OUT_OF_BOUNDS_SIZE = 0x40000000;
const LONG_NAME_LENGTH = 1_000;
const SHORT_STREAM_BYTES = 3;
const GAP_LENGTH = 4;

// Zip signatures as bytes, and the offsets of the little-endian fields the tests read
// or edit.
const LOCAL_HEADER_SIGNATURE: readonly number[] = [0x50, 0x4b, 0x03, 0x04];
const DATA_DESCRIPTOR_SIGNATURE: readonly number[] = [0x50, 0x4b, 0x07, 0x08];
const DIRECTORY_RECORD_SIGNATURE: readonly number[] = [0x50, 0x4b, 0x01, 0x02];
const SIGNATURE_LENGTH = 4;
const LOCAL_FLAGS = 6;
const LOCAL_METHOD = 8;
const LOCAL_TIME = 10;
const LOCAL_DATE = 12;
const LOCAL_CRC = 14;
const LOCAL_COMPRESSED_SIZE = 18;
const LOCAL_UNCOMPRESSED_SIZE = 22;
const LOCAL_NAME = 30;
const RECORD_FLAGS = 8;
const RECORD_METHOD = 10;
const RECORD_TIME = 12;
const RECORD_DATE = 14;
const RECORD_COMPRESSED_SIZE = 20;
const RECORD_HEADER_OFFSET = 42;
const RECORD_NAME = 46;
const END_DISK_ENTRIES = 8;
const END_TOTAL_ENTRIES = 10;
const END_DIRECTORY_OFFSET = 16;
const END_COMMENT_LENGTH = 20;
// The crc of a data descriptor that starts with its signature.
const SIGNED_DESCRIPTOR_CRC = 4;
const ENCRYPTED_FLAG = 0x0001;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const DEFLATED = 8;
const UNKNOWN_METHOD = 99;
const ZIP64_SIZE = 0xffffffff;
// 'PK' read as a little-endian 16-bit field, and the 16-bit field that completes it to
// a local header signature right after it ('\x03\x04').
const PK_FIELD = 0x4b50;
const SIGNATURE_TAIL_FIELD = 0x0403;
const LOW_HALF_MASK = 0xffff;
// More than enough counters to find a content whose crc has a given low half (one in
// 65 536 does).
const CRC_SEARCH_LIMIT = 1 << 22;

function expectRejected(run: () => unknown, reason: string): SpreadsheetFileError {
  const error = fileErrorOf(run);
  expect(error.code).toBe('CORRUPT_FILE');
  expect(error.meta).toMatchObject({ reason });
  return error;
}

function sameBytes(actual: Uint8Array, expected: Uint8Array): boolean {
  return Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength).equals(expected);
}

function entryNamed(layout: ZipLayout, name: string): ZipEntry {
  const entry = layout.entries.find((candidate) => candidate.name === name);
  if (entry === undefined) throw new Error(`no entry named ${name}`);
  return entry;
}

function physicalOrder(layout: ZipLayout): ZipEntry[] {
  return [...layout.entries].sort((a, b) => a.headerOffset - b.headerOffset);
}

/** A deflate cache for rewriteZip that counts what it stores: one store per deflate and crc. */
class CountingDeflateCache extends Map<Uint8Array, DeflatedContent> {
  stores = 0;

  override set(content: Uint8Array, deflated: DeflatedContent): this {
    this.stores += 1;
    return super.set(content, deflated);
  }
}

function descriptorLength(entry: ZipEntry): number {
  return entry.segmentEnd - entry.dataOffset - entry.compressedSize;
}

function bytesOf(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The worksheet with a comment inserted before its end tag. */
function probed(sheetBytes: Uint8Array): Uint8Array {
  const text = strFromU8(sheetBytes);
  if (!text.includes(WORKSHEET_END_TAG)) throw new Error('the worksheet has no end tag');
  return strToU8(text.replace(WORKSHEET_END_TAG, `${PROBE}${WORKSHEET_END_TAG}`));
}

function smallWorkbook(): Buffer {
  return buildXlsxFixture([
    {
      name: 'Sheet1',
      xml: worksheetXml([
        ['Barkod', 'Fiyat'],
        ['B1', 10],
      ]),
    },
  ]);
}

/** A copy of `file` with `edit` applied, given the layout of the original. */
function edited(file: Buffer, edit: (copy: Buffer, layout: ZipLayout) => void): Buffer {
  const layout = readZipLayout(file);
  const copy = Buffer.from(file);
  edit(copy, layout);
  return copy;
}

/** A copy of `file` with `bytes` written at `at`. */
function withBytesAt(file: Uint8Array, at: number, bytes: readonly number[]): Buffer {
  const copy = Buffer.from(file);
  copy.set(bytes, at);
  return copy;
}

/** A copy of `file` with the four bytes at each offset set to zero. */
function withZeroedSignatures(file: Uint8Array, offsets: readonly number[]): Buffer {
  const copy = Buffer.from(file);
  for (const at of offsets) copy.fill(0, at, at + SIGNATURE_LENGTH);
  return copy;
}

/** `file` with four zero bytes in front of its second entry, every later offset moved. */
function withGapBetweenEntries(file: Buffer): Buffer {
  const layout = readZipLayout(file);
  const second = physicalOrder(layout)[1];
  if (second === undefined) throw new Error('the archive has one entry');
  const at = second.headerOffset;
  const out = Buffer.concat([file.subarray(0, at), Buffer.alloc(GAP_LENGTH), file.subarray(at)]);
  for (const entry of layout.entries) {
    if (entry.headerOffset < at) continue;
    out.writeUInt32LE(
      entry.headerOffset + GAP_LENGTH,
      entry.recordOffset + GAP_LENGTH + RECORD_HEADER_OFFSET,
    );
  }
  out.writeUInt32LE(
    layout.directoryOffset + GAP_LENGTH,
    layout.endRecordOffset + GAP_LENGTH + END_DIRECTORY_OFFSET,
  );
  return out;
}

describe('readZipLayout: the real files', () => {
  it('pins the entry count of every fixture', () => {
    expect(FIXTURE_PINS.map((pin) => readZipLayout(readFixture(pin.file)).entries.length)).toEqual(
      FIXTURE_ENTRY_COUNTS,
    );
  });

  it('pins the data descriptor length of every entry of every fixture', () => {
    // Seven of the eight carry bit-3 entries: the signature rule refuses none of them.
    expect(
      FIXTURE_PINS.map((pin) => [
        ...new Set(readZipLayout(readFixture(pin.file)).entries.map(descriptorLength)),
      ]),
    ).toEqual(FIXTURE_DESCRIPTOR_LENGTHS.map((length) => [length]));
  });

  it.each(FIXTURE_PINS)('names the entries of $file as unzipSync does', (pin) => {
    const file = readFixture(pin.file);
    expect(readZipLayout(file).entries.map((entry) => entry.name)).toEqual(
      Object.keys(unzipSync(file)),
    );
  });
});

describe('rewriteZip: no change', () => {
  it.each(FIXTURE_PINS)('copies $file byte for byte', (pin) => {
    const file = readFixture(pin.file);
    const out = rewriteZip(file, readZipLayout(file), new Map<string, ZipChange>());
    expect(sameBytes(out, file)).toBe(true);
  });
});

describe('rewriteZip: replace', () => {
  it.each(FIXTURE_PINS)('rewrites the worksheet entry of $file and copies the rest', (pin) => {
    const file = readFixture(pin.file);
    const layout = readZipLayout(file);
    const before = unzipSync(file);
    const sheetBytes = before[SHEET_PART];
    if (sheetBytes === undefined) throw new Error(`${pin.file}: no ${SHEET_PART}`);
    const content = probed(sheetBytes);

    const out = rewriteZip(
      file,
      layout,
      new Map<string, ZipChange>([[SHEET_PART, { kind: 'replace', content }]]),
    );

    expect(out.byteOffset).toBe(0);
    expect(out.buffer.byteLength).toBe(out.byteLength);
    expect(unzipSync(out)).toEqual({ ...before, [SHEET_PART]: content });

    const outLayout = readZipLayout(out);
    for (const entry of layout.entries) {
      if (entry.name === SHEET_PART) continue;
      const moved = entryNamed(outLayout, entry.name);
      expect(sameBytes(rawSegment(out, moved), rawSegment(file, entry))).toBe(true);
      expect(moved.flags).toBe(entry.flags);
    }

    const original = entryNamed(layout, SHEET_PART);
    const replaced = entryNamed(outLayout, SHEET_PART);
    const outBytes = bytesOf(out);
    const crc = crc32(content);
    expect(replaced.flags & DATA_DESCRIPTOR_FLAG).toBe(0);
    expect(replaced.flags).toBe(original.flags & UTF8_FLAG);
    expect(outBytes.readUInt16LE(replaced.headerOffset + LOCAL_FLAGS)).toBe(replaced.flags);
    expect(replaced.method).toBe(DEFLATED);
    expect(outBytes.readUInt16LE(replaced.headerOffset + LOCAL_METHOD)).toBe(DEFLATED);
    expect(replaced.crc32).toBe(crc);
    expect(outBytes.readUInt32LE(replaced.headerOffset + LOCAL_CRC)).toBe(crc);
    expect(replaced.uncompressedSize).toBe(content.length);
    expect(outBytes.readUInt32LE(replaced.headerOffset + LOCAL_UNCOMPRESSED_SIZE)).toBe(
      content.length,
    );
    expect(outBytes.readUInt32LE(replaced.headerOffset + LOCAL_COMPRESSED_SIZE)).toBe(
      replaced.compressedSize,
    );
    expect(descriptorLength(replaced)).toBe(0);
    for (const field of [LOCAL_TIME, LOCAL_DATE]) {
      expect(outBytes.readUInt16LE(replaced.headerOffset + field)).toBe(
        file.readUInt16LE(original.headerOffset + field),
      );
    }
    for (const field of [RECORD_TIME, RECORD_DATE]) {
      expect(outBytes.readUInt16LE(replaced.recordOffset + field)).toBe(
        file.readUInt16LE(original.recordOffset + field),
      );
    }

    expect(openUpload(out, GUARD_OPTS)[SHEET_PART]).toEqual(content);
  });
});

describe('rewriteZip: deflate cache', () => {
  it('deflates and checksums each replaced content once across calls and writes the same bytes', () => {
    const file = smallWorkbook();
    const layout = readZipLayout(file);
    const sheetBytes = unzipSync(file)[SHEET_PART];
    if (sheetBytes === undefined) throw new Error(`no ${SHEET_PART}`);
    const shared = probed(sheetBytes);
    const rels = strToU8(PROBE);
    const first = new Map<string, ZipChange>([[SHEET_PART, { kind: 'replace', content: shared }]]);
    const second = new Map<string, ZipChange>([
      [SHEET_PART, { kind: 'replace', content: shared }],
      [WORKBOOK_RELS_PART, { kind: 'replace', content: rels }],
    ]);
    const cache = new CountingDeflateCache();

    const cachedFirst = rewriteZip(file, layout, first, cache);
    const cachedSecond = rewriteZip(file, layout, second, cache);

    expect(sameBytes(cachedFirst, rewriteZip(file, layout, first))).toBe(true);
    expect(sameBytes(cachedSecond, rewriteZip(file, layout, second))).toBe(true);
    // Three replacements of two content objects: two deflates, two crcs.
    expect(cache.size).toBe(2);
    expect(cache.stores).toBe(2);
    expect(cache.get(shared)?.crc).toBe(crc32(shared));
    expect(cache.get(rels)?.crc).toBe(crc32(rels));
  });
});

describe('rewriteZip: drop', () => {
  it('drops docProps/app.xml from the commission fixture and copies the rest', () => {
    const file = readFixture(COMMISSION_FIXTURE);
    const layout = readZipLayout(file);

    const out = rewriteZip(
      file,
      layout,
      new Map<string, ZipChange>([[APP_PROPERTIES_PART, { kind: 'drop' }]]),
    );

    expect(Object.keys(unzipSync(out))).toEqual(
      Object.keys(unzipSync(file)).filter((name) => name !== APP_PROPERTIES_PART),
    );
    const outLayout = readZipLayout(out);
    const outBytes = bytesOf(out);
    const count = layout.entries.length - 1;
    expect(outLayout.entries).toHaveLength(count);
    expect(outBytes.readUInt16LE(outLayout.endRecordOffset + END_DISK_ENTRIES)).toBe(count);
    expect(outBytes.readUInt16LE(outLayout.endRecordOffset + END_TOTAL_ENTRIES)).toBe(count);
    for (const entry of outLayout.entries) {
      const source = entryNamed(layout, entry.name);
      expect(sameBytes(rawSegment(out, entry), rawSegment(file, source))).toBe(true);
    }
    expect(() => openUpload(out, GUARD_OPTS)).not.toThrow();
  });

  it('throws a plain Error for a change that names no entry', () => {
    const file = smallWorkbook();
    const run = (): unknown =>
      rewriteZip(
        file,
        readZipLayout(file),
        new Map<string, ZipChange>([['xl/missing.xml', { kind: 'drop' }]]),
      );
    expect(run).toThrow(Error);
    expect(run).not.toThrow(SpreadsheetFileError);
  });
});

describe('entryContent', () => {
  it.each(FIXTURE_PINS)('returns what unzipSync does for every entry of $file', (pin) => {
    const file = readFixture(pin.file);
    const entries = unzipSync(file);
    for (const entry of readZipLayout(file).entries) {
      const expected = entries[entry.name];
      if (expected === undefined) throw new Error(`${pin.file}: no ${entry.name}`);
      expect(sameBytes(entryContent(file, entry), expected)).toBe(true);
    }
  });
});

describe('entryContent: bounded by the declared size', () => {
  function deflatedSheet(): { readonly file: Buffer; readonly entry: ZipEntry } {
    const file = smallWorkbook();
    const entry = entryNamed(readZipLayout(file), SHEET_PART);
    if (entry.method !== DEFLATED) throw new Error('the sheet entry is not deflated');
    return { file, entry };
  }

  it.each<[string, (entry: ZipEntry) => ZipEntry]>([
    [
      'a declared size one byte below the real one',
      (entry) => ({ ...entry, uncompressedSize: entry.uncompressedSize - 1 }),
    ],
    [
      'a declared size one byte above the real one',
      (entry) => ({ ...entry, uncompressedSize: entry.uncompressedSize + 1 }),
    ],
    [
      'a stream that ends early',
      (entry) => ({ ...entry, compressedSize: entry.compressedSize - SHORT_STREAM_BYTES }),
    ],
  ])('refuses %s as a view mismatch', (_, vary) => {
    const { file, entry } = deflatedSheet();
    const error = expectRejected(
      () => entryContent(file, vary(entry)),
      ZIP_REJECT_REASONS.VIEW_MISMATCH,
    );
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.VIEW_MISMATCH, entry: SHEET_PART });
  });

  it('refuses a declared size above MAX_DECOMPRESSED_BYTES before inflating', () => {
    const { file, entry } = deflatedSheet();
    const error = expectRejected(
      () => entryContent(file, { ...entry, uncompressedSize: MAX_DECOMPRESSED_BYTES + 1 }),
      ZIP_REJECT_REASONS.LAYOUT,
    );
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: SHEET_PART });
  });

  it('returns nothing for an empty stream declared empty', () => {
    const { entry } = deflatedSheet();
    const empty = deflateRawSync(Buffer.alloc(0));
    const content = entryContent(empty, {
      ...entry,
      dataOffset: 0,
      compressedSize: empty.length,
      uncompressedSize: 0,
    });
    expect(content).toHaveLength(0);
  });

  it('cuts a long entry name in the error meta', () => {
    const { file, entry } = deflatedSheet();
    const name = 'x'.repeat(LONG_NAME_LENGTH);
    const error = expectRejected(
      () => entryContent(file, { ...entry, name, uncompressedSize: entry.uncompressedSize - 1 }),
      ZIP_REJECT_REASONS.VIEW_MISMATCH,
    );
    expect(error.meta).toEqual({
      reason: ZIP_REJECT_REASONS.VIEW_MISMATCH,
      entry: name.slice(0, MAX_ERROR_CAUSE_LENGTH),
    });
  });
});

describe.each(TILE_KINDS)('the hidden tile: %s', (kind) => {
  it('passes the import gate, which reads the real sheet', () => {
    const { file, realSheet } = hiddenTileArchive(kind);
    // Pins today's import gate, which accepts this file. Flips to toThrow when PR 3 adds the zip-layout and view checks to the import gate.
    expect(openUpload(file, GUARD_OPTS)[SHEET_PART]).toEqual(realSheet);
  });

  it('is refused by the signature rule', () => {
    const { file } = hiddenTileArchive(kind);
    const error = expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: APP_PROPERTIES_PART });
  });
});

describe('the hidden tile behind the layout check', () => {
  it('is laid out as the central directory describes it', () => {
    const { file, layout, plantedSignatures } = hiddenTileArchive('same-sheet');
    const [descriptorAt, headerAt] = plantedSignatures;
    expect([...file.subarray(descriptorAt, descriptorAt + SIGNATURE_LENGTH)]).toEqual(
      DATA_DESCRIPTOR_SIGNATURE,
    );
    expect([...file.subarray(headerAt, headerAt + SIGNATURE_LENGTH)]).toEqual(
      LOCAL_HEADER_SIGNATURE,
    );
    expect(readZipLayout(withZeroedSignatures(file, [descriptorAt, headerAt]))).toEqual(layout);
  });

  it.each([
    ['the fake local header, with the fake descriptor zeroed', 0],
    ['the fake data descriptor, with the fake local header zeroed', 1],
  ] as const)('catches %s', (_, zeroed) => {
    const { file, plantedSignatures } = hiddenTileArchive('same-sheet');
    const error = expectRejected(
      () => readZipLayout(withZeroedSignatures(file, [plantedSignatures[zeroed]])),
      ZIP_REJECT_REASONS.LAYOUT,
    );
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: APP_PROPERTIES_PART });
  });

  it('other-sheet: the tile reads to other cells of the same length', () => {
    const { file, realSheet, tile } = hiddenTileArchive('other-sheet');
    const content = entryContent(file, tile);
    expect(content).toHaveLength(realSheet.length);
    expect(sameBytes(content, realSheet)).toBe(false);
  });

  it('same-sheet: the tile reads to the real sheet', () => {
    // No content check can tell this tile from the real sheet; only the layout rule
    // refuses the file.
    const { file, realSheet, tile } = hiddenTileArchive('same-sheet');
    expect(sameBytes(entryContent(file, tile), realSheet)).toBe(true);
  });

  it('bomb: the tile is refused within the bounded-inflate budget', () => {
    const { file, tile } = hiddenTileArchive('bomb');
    const started = performance.now();
    const error = fileErrorOf(() => entryContent(file, tile));
    // An unbounded inflate of this stream takes more than a second.
    expectWithinBudget(performance.now() - started, BOUNDED_INFLATE_BUDGET_MS);
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.VIEW_MISMATCH, entry: SHEET_PART });
  });
});

describe('readZipLayout: rejected archives', () => {
  it.each<[string, () => Uint8Array]>([
    ['one byte after the end record', () => Buffer.concat([smallWorkbook(), Buffer.alloc(1)])],
    [
      'an archive comment',
      () =>
        Buffer.concat([
          edited(smallWorkbook(), (copy, layout) =>
            copy.writeUInt16LE(1, layout.endRecordOffset + END_COMMENT_LENGTH),
          ),
          Buffer.alloc(1),
        ]),
    ],
    ['four bytes between two entries', () => withGapBetweenEntries(smallWorkbook())],
    [
      'a local header whose name differs from its record by one byte',
      () =>
        edited(smallWorkbook(), (copy, layout) => {
          const at = entryNamed(layout, SHEET_PART).headerOffset + LOCAL_NAME;
          copy.writeUInt8(copy.readUInt8(at) ^ 1, at);
        }),
    ],
    [
      'a local crc that differs from its record without bit 3',
      () =>
        edited(smallWorkbook(), (copy, layout) => {
          const entry = entryNamed(layout, SHEET_PART);
          copy.writeUInt32LE((entry.crc32 ^ 1) >>> 0, entry.headerOffset + LOCAL_CRC);
        }),
    ],
    [
      'a data descriptor crc that differs from its record',
      () =>
        edited(readFixture(COMMISSION_FIXTURE), (copy, layout) => {
          const entry = entryNamed(layout, SHEET_PART);
          const at = entry.dataOffset + entry.compressedSize + SIGNED_DESCRIPTOR_CRC;
          copy.writeUInt32LE((entry.crc32 ^ 1) >>> 0, at);
        }),
    ],
    [
      'a file one byte short',
      () => {
        const file = smallWorkbook();
        return file.subarray(0, file.length - 1);
      },
    ],
  ])('zip-layout: %s', (_, build) => {
    const file = build();
    expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
  });

  it('zip-layout: two entries of one name in both their local headers and their records', () => {
    const file = edited(
      Buffer.from(zipSync({ 'a.xml': strToU8('<a/>'), 'b.xml': strToU8('<b/>') })),
      (copy, layout) => {
        const entry = entryNamed(layout, 'b.xml');
        copy.write('a', entry.headerOffset + LOCAL_NAME);
        copy.write('a', entry.recordOffset + RECORD_NAME);
      },
    );
    const error = expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
    expect(error.message).toBe('Zip directory repeats an entry name');
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: 'a.xml' });
  });

  it(`zip-layout: an archive of ${MAX_ZIP_ENTRIES + 1} entries`, () => {
    const file = zipSync(
      Object.fromEntries(
        Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => [`part${i}.xml`, strToU8('<p/>')]),
      ),
    );
    expect(Object.keys(unzipSync(file))).toHaveLength(MAX_ZIP_ENTRIES + 1);
    const error = expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
    expect(error.message).toBe('Zip end record declares an entry count it cannot have');
  });

  it('zip-layout, not a RangeError: an entry that starts past the directory', () => {
    // The entry before the last declares data that ends one descriptor short of the
    // last entry's new offset, far past the end of the file.
    const original = readFixture(COMMISSION_FIXTURE);
    const [before, last] = physicalOrder(readZipLayout(original)).slice(-2);
    if (before === undefined || last === undefined) throw new Error('the fixture has one entry');
    const file = Buffer.from(original);
    file.writeUInt32LE(OUT_OF_BOUNDS_SIZE, before.recordOffset + RECORD_COMPRESSED_SIZE);
    file.writeUInt32LE(
      before.dataOffset + OUT_OF_BOUNDS_SIZE + descriptorLength(before),
      last.recordOffset + RECORD_HEADER_OFFSET,
    );
    // fileErrorOf rethrows anything but a SpreadsheetFileError, a RangeError included.
    const error = expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
    expect(error.message).toBe('Zip entry starts inside the directory');
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: before.name });
  });

  it.each(UNSIGNED_DESCRIPTOR_LENGTHS)(
    'zip-layout: a bit-3 entry with a %i-byte unsigned data descriptor',
    (length) => {
      const { file, layout } = unsignedDescriptorArchive(length);
      expect(descriptorLength(entryNamed(layout, SHEET_PART))).toBe(length);
      const error = expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
      expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: SHEET_PART });
    },
  );

  it('zip64: a record whose compressed size is 0xFFFFFFFF', () => {
    const file = edited(smallWorkbook(), (copy, layout) => {
      copy.writeUInt32LE(
        ZIP64_SIZE,
        entryNamed(layout, SHEET_PART).recordOffset + RECORD_COMPRESSED_SIZE,
      );
    });
    expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.ZIP64);
  });

  it('zip-encrypted: flag bit 0 in a record and its local header', () => {
    const file = edited(smallWorkbook(), (copy, layout) => {
      const entry = entryNamed(layout, SHEET_PART);
      copy.writeUInt16LE(entry.flags | ENCRYPTED_FLAG, entry.recordOffset + RECORD_FLAGS);
      const local = entry.headerOffset + LOCAL_FLAGS;
      copy.writeUInt16LE(copy.readUInt16LE(local) | ENCRYPTED_FLAG, local);
    });
    expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.ENCRYPTED);
  });

  it('zip-method: method 99 in a record and its local header', () => {
    const file = edited(smallWorkbook(), (copy, layout) => {
      const entry = entryNamed(layout, SHEET_PART);
      copy.writeUInt16LE(UNKNOWN_METHOD, entry.recordOffset + RECORD_METHOD);
      copy.writeUInt16LE(UNKNOWN_METHOD, entry.headerOffset + LOCAL_METHOD);
    });
    expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.METHOD);
  });
});

// The local crc and sizes of a bit-3 entry: the offset of each in the local header, and
// the value its record declares.
const DEFERRED_LOCAL_FIELDS: readonly [string, number, (entry: ZipEntry) => number][] = [
  ['crc', LOCAL_CRC, (entry) => entry.crc32],
  ['compressed size', LOCAL_COMPRESSED_SIZE, (entry) => entry.compressedSize],
  ['uncompressed size', LOCAL_UNCOMPRESSED_SIZE, (entry) => entry.uncompressedSize],
];

describe('readZipLayout: the local crc and sizes of a bit-3 entry', () => {
  it.each(DEFERRED_LOCAL_FIELDS)(
    'refuses a local %s that is neither 0 nor the value of the record',
    (_, field, recordValue) => {
      const original = readFixture(COMMISSION_FIXTURE);
      const entry = entryNamed(readZipLayout(original), SHEET_PART);
      expect(entry.flags & DATA_DESCRIPTOR_FLAG).toBe(DATA_DESCRIPTOR_FLAG);
      expect(original.readUInt32LE(entry.headerOffset + field)).toBe(0);

      const file = Buffer.from(original);
      file.writeUInt32LE((recordValue(entry) ^ 1) >>> 0, entry.headerOffset + field);
      const error = expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
      expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: SHEET_PART });
    },
  );

  it('accepts a local crc and sizes that are the values of the record', () => {
    const file = edited(readFixture(COMMISSION_FIXTURE), (copy, layout) => {
      const entry = entryNamed(layout, SHEET_PART);
      for (const [, field, recordValue] of DEFERRED_LOCAL_FIELDS) {
        copy.writeUInt32LE(recordValue(entry), entry.headerOffset + field);
      }
    });
    expect(() => readZipLayout(file)).not.toThrow();
  });
});

describe.each(ZIP64_SKIP_COPIES)('the zip64 local skip, the copy of the sheet: %s', (copy) => {
  it('passes the import gate, which reads the real sheet', () => {
    const { file, realSheet } = zip64SkipArchive(copy);
    // Pins today's import gate, which accepts this file. Flips to toThrow when PR 3 adds the zip-layout and view checks to the import gate.
    expect(openUpload(file, GUARD_OPTS)[SHEET_PART]).toEqual(realSheet);
  });

  it('is refused by the local zip64 rule', () => {
    const { file } = zip64SkipArchive(copy);
    const error = expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.ZIP64);
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.ZIP64, entry: APP_PROPERTIES_PART });
  });
});

// Written over the data of the worksheet entry; only the data changes, which
// readZipLayout never inflates.
const PLANTED_SIGNATURES: readonly [string, readonly number[], (entry: ZipEntry) => number][] = [
  ['a local header signature', LOCAL_HEADER_SIGNATURE, (entry) => entry.dataOffset + 1],
  ['a data descriptor signature', DATA_DESCRIPTOR_SIGNATURE, (entry) => entry.dataOffset + 1],
  ['a directory record signature', DIRECTORY_RECORD_SIGNATURE, (entry) => entry.dataOffset + 1],
  [
    'a data descriptor signature right in front of the real one',
    DATA_DESCRIPTOR_SIGNATURE,
    (entry) => entry.dataOffset + entry.compressedSize - SIGNATURE_LENGTH,
  ],
];

describe('readZipLayout: the signature rule on a real file', () => {
  it.each(PLANTED_SIGNATURES)('refuses %s inside a bit-3 entry', (_, signature, at) => {
    const file = readFixture(COMMISSION_FIXTURE);
    const entry = entryNamed(readZipLayout(file), SHEET_PART);
    expect(entry.flags & DATA_DESCRIPTOR_FLAG).toBe(DATA_DESCRIPTOR_FLAG);

    const error = expectRejected(
      () => readZipLayout(withBytesAt(file, at(entry), signature)),
      ZIP_REJECT_REASONS.LAYOUT,
    );
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT, entry: SHEET_PART });
  });

  it.each(PLANTED_SIGNATURES)('accepts %s inside an entry without bit 3', (_, signature, at) => {
    const file = readFixture(ONE_PERIOD_FIXTURE);
    const entry = entryNamed(readZipLayout(file), SHEET_PART);
    expect(entry.flags & DATA_DESCRIPTOR_FLAG).toBe(0);

    expect(() => readZipLayout(withBytesAt(file, at(entry), signature))).not.toThrow();
  });
});

describe('the hidden entry', () => {
  it('reads one sheet to the stream and another to the directory, and is refused', () => {
    const { file, realSheet, otherSheet } = hiddenEntryArchive();
    // Pins today's import gate, which accepts this file. Flips to toThrow when PR 3 adds the zip-layout and view checks to the import gate.
    expect(openUpload(file, GUARD_OPTS)[SHEET_PART]).toEqual(realSheet);
    expect(unzipSync(file)[SHEET_PART]).toEqual(otherSheet);
    expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
  });
});

// Past the last entry the gate's stream searches the directory for a local header
// signature too; whether it reads one as an entry or stops at it can depend on fields
// a rewrite changes (see tests/helpers/workbooks.ts).
const DIRECTORY_SIGNATURE_ARCHIVES: readonly [string, () => DirectorySignatureArchive][] = [
  ['a fake entry hidden behind an incomplete header in another record', swallowedEntryArchive],
  ['a bare signature that the next record completes once a size changes', sizeFlipArchive],
];

describe.each(DIRECTORY_SIGNATURE_ARCHIVES)(
  'a local header signature in the directory: %s',
  (_, build) => {
    it('passes the import gate', () => {
      const { file } = build();
      // Pins today's import gate, which accepts this file. Flips to toThrow when PR 3 adds the zip-layout and view checks to the import gate.
      expect(() => openUpload(file, GUARD_OPTS)).not.toThrow();
    });

    it('is refused by readZipLayout', () => {
      const { file } = build();
      const error = expectRejected(() => readZipLayout(file), ZIP_REJECT_REASONS.LAYOUT);
      expect(error.message).toBe('Zip directory holds a local header signature');
      expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT });
    });

    it('is laid out as the directory describes it once the signatures are zeroed', () => {
      const { file, layout, plantedSignatures } = build();
      for (const at of plantedSignatures) {
        expect([...file.subarray(at, at + SIGNATURE_LENGTH)]).toEqual(LOCAL_HEADER_SIGNATURE);
      }
      expect(readZipLayout(withZeroedSignatures(file, plantedSignatures))).toEqual(layout);
    });

    it('is refused by rewriteZip, which checks its own output', () => {
      // The layout the directory describes, which readZipLayout refuses: rewriteZip
      // copies the records as they are and finds the signature in what it wrote.
      const { file, layout } = build();
      const error = expectRejected(
        () => rewriteZip(file, layout, new Map<string, ZipChange>()),
        ZIP_REJECT_REASONS.LAYOUT,
      );
      expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT });
    });
  },
);

/** A content whose crc32 has `lowHalf` as its low 16 bits. */
function contentWithCrcLowHalf(lowHalf: number): Uint8Array {
  for (let counter = 0; counter < CRC_SEARCH_LIMIT; counter += 1) {
    const content = strToU8(`${PROBE}${counter}`);
    if ((crc32(content) & LOW_HALF_MASK) === lowHalf) return content;
  }
  throw new Error('no content with that crc found');
}

describe('rewriteZip: a local header signature its own fields spell', () => {
  it('refuses a new crc that completes a signature with the record date in front of it', () => {
    // A record keeps its date and takes the replaced entry's crc right after it: a date
    // that reads 'PK' and a crc whose low half reads '\x03\x04' spell a local header
    // signature across the two fields. The source directory holds none.
    const file = edited(smallWorkbook(), (copy, layout) => {
      copy.writeUInt16LE(PK_FIELD, entryNamed(layout, SHEET_PART).recordOffset + RECORD_DATE);
    });
    const layout = readZipLayout(file);
    const changes = new Map<string, ZipChange>([
      [SHEET_PART, { kind: 'replace', content: contentWithCrcLowHalf(SIGNATURE_TAIL_FIELD) }],
    ]);

    const error = expectRejected(
      () => rewriteZip(file, layout, changes),
      ZIP_REJECT_REASONS.LAYOUT,
    );
    expect(error.message).toBe('Zip rewrite puts a local header signature into its directory');
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.LAYOUT });

    // Control: the same replacement behind the archive's own date is written.
    const plain = smallWorkbook();
    expect(() => rewriteZip(plain, readZipLayout(plain), changes)).not.toThrow();
  });
});
