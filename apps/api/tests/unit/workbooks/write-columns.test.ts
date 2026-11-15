import { afterEach, describe, expect, it, vi } from 'vitest';

import { Platform } from '@pazarsync/db/enums';
import {
  block,
  defineLayout,
  has,
  header,
  resolveLayout,
  SpreadsheetFileError,
  type ResolvedLayout,
  type SheetData,
} from '@pazarsync/spreadsheet';
import { syncLog } from '@pazarsync/sync-core';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { ValidationError } from '@/lib/errors';
import { defineFormat, type WriteValueSpec } from '@/workbooks/format';
import {
  FLASH_CUSTOM_PRICE_LABEL,
  FLASH_OFFER_24H_LABEL,
} from '@/workbooks/formats/trendyol/labels';
import {
  assertWriteValue,
  missingExportRequirement,
  overwriteFormulaColumns,
  probeValue,
  resolveWriteColumns,
  WRITE_COLUMN_CLASH_REASONS,
} from '@/workbooks/write-columns';
import { toUploadError, WorkbookInvariantError } from '@/workbooks/workbook-errors';

// A synthetic sheet: two plain write columns (one optional and often absent) and a
// repeated period block whose commission column is found by a header carrying the
// block's tag, as the Plus file's `Hesaplanan Komisyon (N Gun)` column is.

const layout = defineLayout({
  headerLookahead: 0,
  required: { barcode: header('Barcode') },
  optional: { selection: header('Selection'), note: header('Note') },
  blocks: {
    period: block({
      anchor: /^Period (\d+)$/,
      follow: [],
      columns: {},
      lookups: { commission: { template: 'Commission {tag}' } },
      min: 0,
    }),
  },
});

const SELECTION_SPEC: WriteValueSpec = { kind: 'text', allow: ['Yes', 'No'] };
const NOTE_SPEC: WriteValueSpec = { kind: 'number', scale: 2 };
const COMMISSION_SPEC: WriteValueSpec = { kind: 'number' };

const format = defineFormat({
  id: 'TRENDYOL:PLUS_COMMISSION_TARIFF:v1',
  platform: Platform.TRENDYOL,
  page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
  sheet: { by: 'index', index: 0 },
  layout,
  keep: has('barcode', 'text'),
  anchor: 'barcode',
  fingerprint: ['Barcode', 'Selection', 'Note'],
  mapRow: (_reader, anchor) => ({ anchor }),
  writeBack: {
    selection: {
      target: { kind: 'column', key: 'selection' },
      value: SELECTION_SPEC,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    note: {
      target: { kind: 'column', key: 'note' },
      value: NOTE_SPEC,
      overwritesFormula: false,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    commission: {
      target: { kind: 'blockLookup', block: 'period', lookup: 'commission' },
      value: COMMISSION_SPEC,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  exportRequires: [['selection', 'commission']],
  prefilled: 'ignore',
  defaultName: 'Synthetic tariff',
  filename: { kind: 'fixed', base: 'synthetic' },
});

// A column target whose header is the tag-3 commission header: both land on one cell.
const clashLayout = defineLayout({
  headerLookahead: 0,
  required: { barcode: header('Barcode') },
  optional: { total: header('Commission 3') },
  blocks: {
    period: block({
      anchor: /^Period (\d+)$/,
      follow: [],
      columns: {},
      lookups: { commission: { template: 'Commission {tag}' } },
      min: 0,
    }),
  },
});

const clashFormat = defineFormat({
  id: 'TRENDYOL:PLUS_COMMISSION_TARIFF:v2',
  platform: Platform.TRENDYOL,
  page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF,
  sheet: { by: 'index', index: 0 },
  layout: clashLayout,
  keep: has('barcode', 'text'),
  anchor: 'barcode',
  fingerprint: ['Barcode', 'Commission 3', 'Period 3'],
  mapRow: (_reader, anchor) => ({ anchor }),
  writeBack: {
    total: {
      target: { kind: 'column', key: 'total' },
      value: COMMISSION_SPEC,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    commission: {
      target: { kind: 'blockLookup', block: 'period', lookup: 'commission' },
      value: COMMISSION_SPEC,
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  exportRequires: [['total']],
  prefilled: 'ignore',
  defaultName: 'Synthetic clash',
  filename: { kind: 'fixed', base: 'synthetic' },
});

function resolved(spec: Parameters<typeof resolveLayout>[0], headerRow: SheetData[number]) {
  const result = resolveLayout(spec, [headerRow, ['8690000000001']]);
  if (result === null) throw new Error('the test header row must resolve');
  return result;
}

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the function to throw');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveWriteColumns', () => {
  it('returns a resolved column target, drops an absent one, and keeps one entry per resolved block lookup', () => {
    // `note` is absent; block 3 has its commission header, block 4 does not.
    const resolvedLayout: ResolvedLayout = resolved(layout, [
      'Barcode',
      'Selection',
      'Period 3',
      'Commission 3',
      'Period 4',
    ]);
    expect(resolveWriteColumns(format, resolvedLayout)).toEqual([
      { key: 'selection', tag: null, col: 1, spec: SELECTION_SPEC },
      { key: 'commission', tag: 3, col: 3, spec: COMMISSION_SPEC },
    ]);
  });

  it('refuses two blocks with one tag whose lookups resolve to one column with MALFORMED_SHEET, a 422 on upload', () => {
    vi.spyOn(syncLog, 'info').mockImplementation(() => undefined);
    const resolvedLayout = resolved(layout, [
      'Barcode',
      'Selection',
      'Period 3',
      'Period 3',
      'Commission 3',
    ]);
    const err = captureThrow(() => resolveWriteColumns(format, resolvedLayout));
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: WRITE_COLUMN_CLASH_REASONS.SHARED_TAG });

    const mapped = captureThrow(() =>
      toUploadError(err, {}, { page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF }),
    );
    expect(mapped).toBeInstanceOf(ValidationError);
    if (!(mapped instanceof ValidationError)) return;
    expect(mapped.issues).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
  });

  it('refuses a column target and a block lookup that land on one column with MALFORMED_SHEET, a 422 on upload', () => {
    vi.spyOn(syncLog, 'info').mockImplementation(() => undefined);
    const resolvedLayout = resolved(clashLayout, ['Barcode', 'Period 3', 'Commission 3']);
    const err = captureThrow(() => resolveWriteColumns(clashFormat, resolvedLayout));
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    if (!(err instanceof SpreadsheetFileError)) return;
    expect(err.code).toBe('MALFORMED_SHEET');
    expect(err.meta).toEqual({ reason: WRITE_COLUMN_CLASH_REASONS.SHARED_COLUMN });

    const mapped = captureThrow(() =>
      toUploadError(err, {}, { page: WORKBOOK_PAGES.PLUS_COMMISSION_TARIFF }),
    );
    expect(mapped).toBeInstanceOf(ValidationError);
    if (!(mapped instanceof ValidationError)) return;
    expect(mapped.issues).toEqual([{ field: 'file', code: 'MALFORMED_SHEET' }]);
  });
});

describe('overwriteFormulaColumns', () => {
  it('lists the resolved columns whose write column overwrites a formula, ascending', () => {
    const resolvedLayout = resolved(layout, [
      'Barcode',
      'Commission 3',
      'Period 3',
      'Note',
      'Selection',
    ]);
    const columns = resolveWriteColumns(format, resolvedLayout);
    expect(overwriteFormulaColumns(format, columns)).toEqual([1, 4]);
  });
});

describe('missingExportRequirement', () => {
  it('is false when every requirement group has a resolved key', () => {
    const resolvedLayout = resolved(layout, ['Barcode', 'Period 3', 'Commission 3']);
    expect(missingExportRequirement(format, resolveWriteColumns(format, resolvedLayout))).toBe(
      false,
    );
  });

  it('is true when a requirement group has no resolved key', () => {
    const resolvedLayout = resolved(layout, ['Barcode', 'Note', 'Period 3']);
    expect(missingExportRequirement(format, resolveWriteColumns(format, resolvedLayout))).toBe(
      true,
    );
  });
});

describe('probeValue', () => {
  it('is ten integer nines and scale fraction nines for a scaled number', () => {
    expect(probeValue({ kind: 'number', scale: 2 })).toEqual({
      kind: 'number',
      value: '9999999999.99',
      scale: 2,
    });
  });

  it('is ten nines for a number without a scale', () => {
    expect(probeValue({ kind: 'number' })).toEqual({ kind: 'number', value: '9999999999' });
  });

  it('is the allow-list member with the most UTF-8 bytes', () => {
    expect(
      probeValue({ kind: 'text', allow: [FLASH_OFFER_24H_LABEL, FLASH_CUSTOM_PRICE_LABEL] }),
    ).toEqual({ kind: 'text', value: FLASH_CUSTOM_PRICE_LABEL });
  });

  it('counts UTF-8 bytes, not UTF-16 length, between allow-list members', () => {
    // 'abcd' is 4 units and 4 bytes; three c-cedillas (U+00E7) are 3 units and 6 bytes.
    const cedillas = String.fromCodePoint(0xe7).repeat(3);
    expect(probeValue({ kind: 'text', allow: ['abcd', cedillas] })).toEqual({
      kind: 'text',
      value: cedillas,
    });
  });

  it('is the author-given probe of a pattern column', () => {
    expect(probeValue({ kind: 'text', pattern: /^\d+ days$/, probe: '9999 days' })).toEqual({
      kind: 'text',
      value: '9999 days',
    });
  });
});

describe('assertWriteValue', () => {
  const scaled: WriteValueSpec = { kind: 'number', scale: 2 };
  const unscaled: WriteValueSpec = { kind: 'number' };
  const WIDER_THAN_PROBE = 'A written value is wider than the rehearsal probe of its column';

  it.each(['15.40', '0.00'])('accepts %s at scale 2', (value) => {
    expect(() => assertWriteValue(scaled, value)).not.toThrow();
  });

  it.each(['7', '7.125', '1234567890'])('accepts %s without a scale', (value) => {
    expect(() => assertWriteValue(unscaled, value)).not.toThrow();
  });

  it.each(['15.4', '-5.00'])('refuses %s at scale 2', (value) => {
    expect(() => assertWriteValue(scaled, value)).toThrow(WorkbookInvariantError);
  });

  it.each(['1e3', '1,50', '-0', '01.00', '', '12345678901'])(
    'refuses %s without a scale',
    (value) => {
      expect(() => assertWriteValue(unscaled, value)).toThrow(WorkbookInvariantError);
    },
  );

  it('accepts an allow-list member and refuses any other text', () => {
    expect(() => assertWriteValue(SELECTION_SPEC, 'Yes')).not.toThrow();
    expect(() => assertWriteValue(SELECTION_SPEC, 'Maybe')).toThrow(WorkbookInvariantError);
  });

  it('accepts text matching the pattern and refuses any other text', () => {
    const spec: WriteValueSpec = { kind: 'text', pattern: /^\d+ days$/, probe: '9999 days' };
    expect(() => assertWriteValue(spec, '7 days')).not.toThrow();
    expect(() => assertWriteValue(spec, 'seven days')).toThrow(WorkbookInvariantError);
  });

  it('refuses an unscaled number with more UTF-8 bytes than its probe and accepts narrower ones', () => {
    expect(() => assertWriteValue(unscaled, '9999999999.5')).toThrow(WorkbookInvariantError);
    expect(() => assertWriteValue(unscaled, '9999999999.5')).toThrow(WIDER_THAN_PROBE);
    expect(() => assertWriteValue(unscaled, '12.5')).not.toThrow();
    expect(() => assertWriteValue(unscaled, '0.000001')).not.toThrow();
  });

  it('refuses a pattern value with more UTF-8 bytes than its probe and accepts the probe', () => {
    const spec: WriteValueSpec = { kind: 'text', pattern: /^\d+ x$/, probe: '7 x' };
    expect(() => assertWriteValue(spec, '77 x')).toThrow(WorkbookInvariantError);
    expect(() => assertWriteValue(spec, '77 x')).toThrow(WIDER_THAN_PROBE);
    expect(() => assertWriteValue(spec, '7 x')).not.toThrow();
  });
});

describe('defineFormat', () => {
  it('throws at definition for a pattern probe that does not match its pattern', () => {
    expect(() =>
      defineFormat({
        ...format,
        writeBack: {
          ...format.writeBack,
          selection: {
            target: { kind: 'column', key: 'selection' },
            value: { kind: 'text', pattern: /^\d+ days$/, probe: 'many days' },
            overwritesFormula: true,
            seededFromSource: false,
            clearWhenUnselected: false,
          },
        },
      }),
    ).toThrow();
  });

  it('throws at definition for a pattern with the g flag (its lastIndex would carry over)', () => {
    expect(() =>
      defineFormat({
        ...format,
        writeBack: {
          ...format.writeBack,
          selection: {
            target: { kind: 'column', key: 'selection' },
            value: { kind: 'text', pattern: /^\d+ days$/g, probe: '9999 days' },
            overwritesFormula: true,
            seededFromSource: false,
            clearWhenUnselected: false,
          },
        },
      }),
    ).toThrow();
  });

  it('throws at definition for a negative scale (its probe fails its own rule)', () => {
    expect(() =>
      defineFormat({
        ...format,
        writeBack: {
          ...format.writeBack,
          note: {
            target: { kind: 'column', key: 'note' },
            value: { kind: 'number', scale: -1 },
            overwritesFormula: false,
            seededFromSource: false,
            clearWhenUnselected: false,
          },
        },
      }),
    ).toThrow();
  });

  it('throws at definition for an empty exportRequires group', () => {
    expect(() => defineFormat({ ...format, exportRequires: [['selection'], []] })).toThrow();
  });
});
