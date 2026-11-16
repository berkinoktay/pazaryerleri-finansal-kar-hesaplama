import { describe, expect, it, vi } from 'vitest';

import { Platform } from '@pazarsync/db/enums';
import {
  all,
  defineLayout,
  has,
  header,
  PATCH_LIMIT_REASONS,
  readWorkbookGrid,
  resolveLayout,
  SpreadsheetFileError,
  type CellPatch,
  type LayoutSpec,
  type SheetData,
  type SheetSelector,
} from '@pazarsync/spreadsheet';
import { buildXlsxFixture, patchFixture, worksheetXml } from '@pazarsync/spreadsheet/testing';
import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { defineFormat, type WorkbookFormat } from '@/workbooks/format';
import {
  FLASH_CUSTOM_PRICE_LABEL,
  FLASH_OFFER_24H_LABEL,
  FLASH_OFFER_3H_LABEL,
} from '@/workbooks/formats/trendyol/labels';
import { readRows } from '@/workbooks/import-rows';
import { buildRehearsal, rehearsalTargets } from '@/workbooks/rehearsal';
import type { SelectedFormat } from '@/workbooks/select-format';
import { resolveWriteColumns } from '@/workbooks/write-columns';

// The growth-cap case reads its workbook through the parse worker, whose cold start can
// pass vitest's 5 s default under load.
vi.setConfig({ testTimeout: 60_000 });

const HEADER = ['Barcode', 'Price', 'Selection', 'Label'] as const;

const layout = defineLayout({
  headerLookahead: 0,
  required: { barcode: header('Barcode'), price: header('Price') },
  optional: { selection: header('Selection'), label: header('Label') },
  blocks: {},
});

const FORMAT = defineFormat({
  id: 'TRENDYOL:ADVANTAGE_TARIFF:v1',
  platform: Platform.TRENDYOL,
  page: WORKBOOK_PAGES.ADVANTAGE_TARIFF,
  sheet: { by: 'name', name: 'Products' },
  layout,
  // Barcode and price, as the advantage keep rule: a barcode without a price is dropped.
  keep: all(has('barcode', 'text'), has('price', 'decimal')),
  anchor: 'barcode',
  fingerprint: ['Barcode', 'Price', 'Selection'],
  mapRow: (_reader, anchor) => ({ barcode: anchor }),
  writeBack: {
    selection: {
      target: { kind: 'column', key: 'selection' },
      value: { kind: 'number', scale: 2 },
      overwritesFormula: true,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
    label: {
      target: { kind: 'column', key: 'label' },
      value: { kind: 'text', allow: ['No', 'Yes'] },
      overwritesFormula: false,
      seededFromSource: false,
      clearWhenUnselected: false,
    },
  },
  exportRequires: [['selection']],
  prefilled: 'ignore',
  defaultName: 'Synthetic list',
  filename: { kind: 'fixed', base: 'synthetic' },
});

function selectedOf<S extends LayoutSpec, TRow, TWrite extends string>(
  format: WorkbookFormat<S, TRow, TWrite>,
  grid: SheetData,
): SelectedFormat<S, TRow, TWrite> {
  const resolved = resolveLayout(format.layout, grid);
  if (resolved === null) throw new Error('synthetic layout did not resolve');
  return { format, grid, layout: resolved };
}

function selected(
  grid: SheetData,
): SelectedFormat<typeof layout, { barcode: string }, 'selection' | 'label'> {
  return selectedOf(FORMAT, grid);
}

const PROBE_NUMBER = { kind: 'number', value: '9999999999.99', scale: 2 } as const;
const PROBE_LABEL = { kind: 'text', value: 'Yes' } as const;

describe('buildRehearsal', () => {
  it('probes every write column of every target row, sorted by row then column', () => {
    const sel = selected([[...HEADER], ['B-1', 10], ['B-2', 20]]);
    const read = readRows(sel);
    const resolved = resolveWriteColumns(sel.format, sel.layout);

    const rehearsal = buildRehearsal(sel, rehearsalTargets('cursor-zip', read), resolved);

    expect(rehearsal.patches).toEqual([
      { excelRow: 2, col: 2, value: PROBE_NUMBER },
      { excelRow: 2, col: 3, value: PROBE_LABEL },
      { excelRow: 3, col: 2, value: PROBE_NUMBER },
      { excelRow: 3, col: 3, value: PROBE_LABEL },
    ]);
    expect(rehearsal.anchors).toEqual([
      { excelRow: 2, col: 0, expected: 'B-1' },
      { excelRow: 3, col: 0, expected: 'B-2' },
    ]);
    // Only the selection column may overwrite a formula.
    expect(rehearsal.overwriteFormulaColumns).toEqual([2]);
  });

  it('patches nothing when the format resolved no write column', () => {
    // Both write columns are optional and the sheet has neither.
    const sel = selected([
      ['Barcode', 'Price'],
      ['B-1', 10],
    ]);
    const read = readRows(sel);

    const rehearsal = buildRehearsal(
      sel,
      rehearsalTargets('cursor-zip', read),
      resolveWriteColumns(sel.format, sel.layout),
    );

    expect(rehearsal.patches).toEqual([]);
  });

  it('rehearses every anchored row for an anchor-map export, the kept rows only for cursor-zip', () => {
    // Sheet row 3 has a barcode but no price: the keep rule drops it, an anchor-map
    // export can still reach it through a repeated barcode.
    const sel = selected([[...HEADER], ['B-1', 10], ['B-2', null]]);
    const read = readRows(sel);
    const resolved = resolveWriteColumns(sel.format, sel.layout);

    const anchorMap = buildRehearsal(sel, rehearsalTargets('anchor-map', read), resolved);
    const cursorZip = buildRehearsal(sel, rehearsalTargets('cursor-zip', read), resolved);

    expect(anchorMap.anchors.map((a) => a.excelRow)).toEqual([2, 3]);
    expect([...new Set(anchorMap.patches.map((p) => p.excelRow))]).toEqual([2, 3]);
    expect(cursorZip.anchors.map((a) => a.excelRow)).toEqual([2]);
    expect([...new Set(cursorZip.patches.map((p) => p.excelRow))]).toEqual([2]);
  });
});

describe('the rehearsal meets the growth cap whenever an export could', () => {
  // A flash-shaped format: a label column whose allow list holds the three flash labels
  // and a two-decimal price column, on a sheet of short rows that hold neither.
  const FLASH_HEADER = ['Barcode', 'Price', 'Updated', 'Custom'] as const;
  const FIRST_SHEET: SheetSelector = { by: 'index', index: 0 };
  // Enough short rows that writing the longest label into each crosses the patched
  // part's growth cap (64 KiB over the source here), while the shortest label does not.
  const ROWS = 700;

  const flashLayout = defineLayout({
    headerLookahead: 0,
    required: { barcode: header('Barcode'), price: header('Price') },
    optional: { updated: header('Updated'), custom: header('Custom') },
    blocks: {},
  });

  const flashFormat = defineFormat({
    id: 'TRENDYOL:FLASH_PRODUCT_LIST:v1',
    platform: Platform.TRENDYOL,
    page: WORKBOOK_PAGES.FLASH_PRODUCT_LIST,
    sheet: FIRST_SHEET,
    layout: flashLayout,
    keep: has('barcode', 'text'),
    anchor: 'barcode',
    fingerprint: ['Barcode', 'Price', 'Updated'],
    mapRow: (_reader, anchor) => ({ barcode: anchor }),
    writeBack: {
      updated: {
        target: { kind: 'column', key: 'updated' },
        value: {
          kind: 'text',
          allow: [FLASH_OFFER_24H_LABEL, FLASH_OFFER_3H_LABEL, FLASH_CUSTOM_PRICE_LABEL],
        },
        overwritesFormula: true,
        seededFromSource: false,
        clearWhenUnselected: false,
      },
      custom: {
        target: { kind: 'column', key: 'custom' },
        value: { kind: 'number', scale: 2 },
        overwritesFormula: true,
        seededFromSource: false,
        clearWhenUnselected: false,
      },
    },
    exportRequires: [['updated']],
    prefilled: 'ignore',
    defaultName: 'Synthetic flash list',
    filename: { kind: 'fixed', base: 'synthetic' },
  });

  const rows: (string | number)[][] = [
    [...FLASH_HEADER],
    ...Array.from({ length: ROWS }, (_, i) => [`B-${i + 1}`, 10]),
  ];
  const source = buildXlsxFixture([{ name: 'Products', xml: worksheetXml(rows) }]);

  function growthReason(patches: readonly CellPatch[], overwrite: readonly number[]): unknown {
    try {
      patchFixture(source, patches, { sheet: FIRST_SHEET, overwriteFormulaColumns: overwrite });
      return null;
    } catch (err) {
      if (!(err instanceof SpreadsheetFileError)) throw err;
      return { code: err.code, reason: err.meta['reason'] };
    }
  }

  it('probes the label column with the longest label and fails where the export would', async () => {
    const grid = await readWorkbookGrid(source, { sheet: FIRST_SHEET });
    const sel = selectedOf(flashFormat, grid);
    const read = readRows(sel);
    const rehearsal = buildRehearsal(
      sel,
      rehearsalTargets('anchor-map', read),
      resolveWriteColumns(sel.format, sel.layout),
    );

    const labels = new Set(
      rehearsal.patches.flatMap((p) => (p.value.kind === 'text' ? [p.value.value] : [])),
    );
    expect([...labels]).toEqual([FLASH_CUSTOM_PRICE_LABEL]);
    expect(growthReason(rehearsal.patches, rehearsal.overwriteFormulaColumns)).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      reason: PATCH_LIMIT_REASONS.GROWTH,
    });

    // The same rows written with the shortest label fit: a probe of the first label
    // would have passed the rehearsal and failed the export.
    const shortest = rehearsal.patches.map(
      (p): CellPatch =>
        p.value.kind === 'text'
          ? { ...p, value: { kind: 'text', value: FLASH_OFFER_3H_LABEL } }
          : p,
    );
    expect(growthReason(shortest, rehearsal.overwriteFormulaColumns)).toBeNull();
  });
});
