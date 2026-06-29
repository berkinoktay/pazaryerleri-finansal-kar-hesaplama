import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { SpreadsheetFileError } from './errors';
import { assertValidUpload } from './guards';
import { exportToXlsx } from './export';
import { miniProductsSchema, type MiniProductsRow } from '../tests/fixtures/mini-schemas';
import { Decimal } from 'decimal.js';

const opts = { rowCap: 5000, colCap: 64, maxBytes: 10 * 1024 * 1024 };

// Type-safe helper: run assertValidUpload and return the error if it throws SpreadsheetFileError,
// null if it succeeds, or re-throw anything unexpected.
function catchGuard(
  file: Buffer,
  o: Parameters<typeof assertValidUpload>[1],
): SpreadsheetFileError | null {
  try {
    assertValidUpload(file, o);
    return null;
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return e;
    throw e;
  }
}

describe('assertValidUpload', () => {
  it('rejects a non-zip (no PK magic) as NOT_XLSX', () => {
    const err = catchGuard(Buffer.from('hello world'), opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('NOT_XLSX');
  });

  it('rejects a zip lacking xlsx structure as NOT_XLSX', () => {
    const notXlsx = Buffer.from(zipSync({ 'a.txt': strToU8('x') }));
    const err = catchGuard(notXlsx, opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('NOT_XLSX');
  });

  it('rejects an oversize buffer as PAYLOAD_TOO_LARGE', () => {
    const big = Buffer.alloc(opts.maxBytes + 1, 0x50);
    const err = catchGuard(big, opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a real generated xlsx without throwing', async () => {
    const rows: MiniProductsRow[] = [
      {
        variantKey: 'V1',
        barcode: '1',
        title: 't',
        cost: new Decimal('1'),
        price: new Decimal('2'),
        profit: new Decimal('1'),
      },
    ];
    const buf = await exportToXlsx(miniProductsSchema, rows);
    expect(() => assertValidUpload(buf, opts)).not.toThrow();
  });

  it('rejects when dimension cols exceed colCap as COL_CAP_EXCEEDED', async () => {
    const rows: MiniProductsRow[] = [
      {
        variantKey: 'V1',
        barcode: '1',
        title: 't',
        cost: new Decimal('1'),
        price: new Decimal('2'),
        profit: new Decimal('1'),
      },
    ];
    const buf = await exportToXlsx(miniProductsSchema, rows);
    const err = catchGuard(buf, { ...opts, colCap: 2 });
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('COL_CAP_EXCEEDED');
  });

  it('fires streaming ceiling on a crafted zip-bomb payload', () => {
    // 300_000 bytes of repeating '0' compresses to ~300 bytes;
    // a tiny maxDecompressedBytes cap of 1_000 forces the streaming guard
    // to abort before the full payload is inflated — proving the ceiling
    // fires from real inflated bytes, not from attacker-controlled metadata.
    const bomb = Buffer.from(zipSync({ 'bomb.txt': strToU8('0'.repeat(300_000)) }));
    const err = catchGuard(bomb, { ...opts, maxDecompressedBytes: 1_000 });
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
