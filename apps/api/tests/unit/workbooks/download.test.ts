import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { WorkbookConflictError, type WorkbookConflictReason } from '@/lib/errors';
import {
  bundleDownload,
  downloadFilenames,
  downloadHeaders,
  XLSX_MIME,
  ZIP_MIME,
  type DownloadFile,
} from '@/workbooks/download';
import type { FilenamePolicy } from '@/workbooks/format';
import { TRENDYOL_DEFAULT_NAMES } from '@/workbooks/formats/trendyol/labels';
import { WorkbookInvariantError } from '@/workbooks/workbook-errors';

const FIXED: FilenamePolicy = { kind: 'fixed', base: 'flas-urunler' };
const WINDOW: FilenamePolicy = {
  kind: 'window',
  base: 'urun-komisyon-tarifesi',
  labelUnit: 'Days',
  fileUnit: 'gunluk',
};
const SOURCE_FIXED: FilenamePolicy = {
  kind: 'source',
  fallback: { kind: 'fixed', base: 'indirimler' },
};
const SOURCE_LIST_NAME: FilenamePolicy = { kind: 'source', fallback: { kind: 'list-name' } };

const ADVANTAGE_DEFAULT = TRENDYOL_DEFAULT_NAMES.ADVANTAGE_TARIFF;
// The advantage default name, spelled here without the labels module.
const ADVANTAGE_DEFAULT_FILE = `Avantajl${String.fromCodePoint(0x131)} ${String.fromCodePoint(0xdc)}r${String.fromCodePoint(0xfc)}n Etiketleri.xlsx`;

const RLO = String.fromCodePoint(0x202e);
const BEL = String.fromCodePoint(0x07);

function source(
  sourceFilename: string | null,
  name = 'My list',
  defaultName = ADVANTAGE_DEFAULT,
): { name: string; sourceFilename: string | null; defaultName: string } {
  return { name, sourceFilename, defaultName };
}

function conflictReason(run: () => unknown): WorkbookConflictReason | null {
  try {
    run();
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.reason;
    throw err;
  }
  return null;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_LENGTH = 30;

/** The compression method of every local file header of a zip, walking entry by entry. */
function compressionMethods(zip: Buffer): number[] {
  const methods: number[] = [];
  let offset = 0;
  while (
    offset + LOCAL_HEADER_LENGTH <= zip.length &&
    zip.readUInt32LE(offset) === LOCAL_HEADER_SIGNATURE
  ) {
    methods.push(zip.readUInt16LE(offset + 8));
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    offset += LOCAL_HEADER_LENGTH + nameLength + extraLength + compressedSize;
  }
  return methods;
}

describe('downloadFilenames', () => {
  it('names a fixed policy file after its base', () => {
    expect(downloadFilenames(FIXED, source(null), [null])).toEqual(['flas-urunler.xlsx']);
  });

  it('names window files after their day count, and the zero-selection file after the base', () => {
    expect(downloadFilenames(WINDOW, source(null), [3, 4])).toEqual([
      'urun-komisyon-tarifesi-3-gunluk.xlsx',
      'urun-komisyon-tarifesi-4-gunluk.xlsx',
    ]);
    expect(downloadFilenames(WINDOW, source(null), [7])).toEqual([
      'urun-komisyon-tarifesi-7-gunluk.xlsx',
    ]);
    expect(downloadFilenames(WINDOW, source(null), [null])).toEqual([
      'urun-komisyon-tarifesi.xlsx',
    ]);
  });

  it('keeps a clean stored upload name for a source policy', () => {
    expect(downloadFilenames(SOURCE_FIXED, source('trendyol_indirimler.xlsx'), [null])).toEqual([
      'trendyol_indirimler.xlsx',
    ]);
  });

  it('cleans a legacy stored name with a control or format character', () => {
    expect(downloadFilenames(SOURCE_FIXED, source(`rapor${BEL}${RLO}.xlsx`), [null])).toEqual([
      'rapor.xlsx',
    ]);
  });

  it('falls back to the fixed base when there is no usable stored name', () => {
    for (const stored of [null, 'rapor.xls', 'rapor', '.xlsx']) {
      expect(downloadFilenames(SOURCE_FIXED, source(stored), [null])).toEqual(['indirimler.xlsx']);
    }
  });

  it('falls back to the list name, then to the default name', () => {
    expect(downloadFilenames(SOURCE_LIST_NAME, source(null, 'A/B'), [null])).toEqual(['AB.xlsx']);
    expect(downloadFilenames(SOURCE_LIST_NAME, source('rapor.xls', 'A/B'), [null])).toEqual([
      'AB.xlsx',
    ]);
    expect(downloadFilenames(SOURCE_LIST_NAME, source(null, `${RLO}${BEL} `), [null])).toEqual([
      ADVANTAGE_DEFAULT_FILE,
    ]);
  });
});

describe('bundleDownload', () => {
  const ONE: DownloadFile = { filename: 'a-3-gunluk.xlsx', file: Buffer.from('first file bytes') };
  const TWO: DownloadFile = { filename: 'a-4-gunluk.xlsx', file: Buffer.from('second file') };

  it('hands a lone file back as it is, as an xlsx', () => {
    const bundle = bundleDownload(WINDOW, [ONE]);

    expect(bundle.body).toBe(ONE.file);
    expect(bundle.filename).toBe(ONE.filename);
    expect(bundle.contentType).toBe(XLSX_MIME);
  });

  it('zips several files under the base name, stored and not deflated', () => {
    const bundle = bundleDownload(WINDOW, [ONE, TWO]);

    expect(bundle.filename).toBe('urun-komisyon-tarifesi.zip');
    expect(bundle.contentType).toBe(ZIP_MIME);
    expect(compressionMethods(bundle.body)).toEqual([0, 0]);
    expect(bundle.body.length).toBeGreaterThanOrEqual(ONE.file.length + TWO.file.length);
    const entries = unzipSync(new Uint8Array(bundle.body));
    expect(Object.keys(entries)).toEqual([ONE.filename, TWO.filename]);
    expect(Buffer.from(entries[ONE.filename] ?? new Uint8Array()).equals(ONE.file)).toBe(true);
    expect(Buffer.from(entries[TWO.filename] ?? new Uint8Array()).equals(TWO.file)).toBe(true);
  });

  it('refuses two files with one name with EXPORT_FILENAME_COLLISION', () => {
    expect(
      conflictReason(() => bundleDownload(FIXED, [ONE, { ...TWO, filename: ONE.filename }])),
    ).toBe('EXPORT_FILENAME_COLLISION');
  });

  // Ported from the deleted commission-tariff-export-plan.test.ts: an export always plans
  // at least one file, so none is our own bug.
  it('throws WorkbookInvariantError when there is no file to deliver', () => {
    expect(() => bundleDownload(WINDOW, [])).toThrow(WorkbookInvariantError);
  });
});

describe('downloadHeaders', () => {
  it('sets the five download headers', () => {
    const body = Buffer.from('xlsx bytes');

    expect(downloadHeaders({ body, filename: 'indirimler.xlsx', contentType: XLSX_MIME })).toEqual({
      'Content-Type': XLSX_MIME,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition':
        'attachment; filename="indirimler.xlsx"; filename*=UTF-8\'\'indirimler.xlsx',
    });
  });
});
