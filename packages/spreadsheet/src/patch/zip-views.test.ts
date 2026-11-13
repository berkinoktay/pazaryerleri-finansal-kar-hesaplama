import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../../tests/helpers/errors';
import { BOUNDED_INFLATE_BUDGET_MS, expectWithinBudget } from '../../tests/helpers/timing';
import { hiddenTileArchive, type HiddenTileArchive } from '../../tests/helpers/workbooks';
import { DEFAULT_COL_CAP, DEFAULT_MAX_BYTES, DEFAULT_ROW_CAP } from '../constants';
import { openUpload, type UploadParts } from '../guards';
import { buildXlsxFixture, worksheetXml } from '../testing/build-xlsx';
import { entryContent, readZipLayout } from './raw-zip';
import { ZIP_REJECT_REASONS } from './reasons';
import { assertSameViews } from './zip-views';

const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const WORKBOOK_PART = 'xl/workbook.xml';
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const GUARD_OPTS = {
  rowCap: DEFAULT_ROW_CAP,
  colCap: DEFAULT_COL_CAP,
  maxBytes: DEFAULT_MAX_BYTES,
} as const;

/**
 * The reader parts the gate's stream reads from a hidden tile archive: the real sheet,
 * and the workbook rels and the workbook, which both views share. openUpload itself
 * refuses the archive at its layout check, before it returns any part.
 */
function streamedParts(archive: HiddenTileArchive): UploadParts {
  const shared = (name: string): Uint8Array => {
    const entry = archive.layout.entries.find((candidate) => candidate.name === name);
    if (entry === undefined) throw new Error(`no entry named ${name}`);
    return entryContent(archive.file, entry);
  };
  return {
    [WORKBOOK_RELS_PART]: shared(WORKBOOK_RELS_PART),
    [WORKBOOK_PART]: shared(WORKBOOK_PART),
    [SHEET_PART]: archive.realSheet,
  };
}

describe('assertSameViews', () => {
  const file = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml([[7]]) }]);
  const parts = openUpload(file, GUARD_OPTS);
  const layout = readZipLayout(file);
  const sheetBytes = parts[SHEET_PART];
  if (sheetBytes === undefined) throw new Error(`no part named ${SHEET_PART}`);

  it('passes the parts the gate read', () => {
    expect(() => assertSameViews(file, layout, parts)).not.toThrow();
  });

  it.each<[string, Uint8Array]>([
    ['one byte changed', Uint8Array.from(sheetBytes, (byte, at) => (at === 0 ? byte ^ 1 : byte))],
    ['one byte appended', Uint8Array.from([...sheetBytes, 0x20])],
  ])('refuses a worksheet part with %s', (_, changed) => {
    const error = fileErrorOf(() =>
      assertSameViews(file, layout, { ...parts, [SHEET_PART]: changed }),
    );
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.VIEW_MISMATCH, entry: SHEET_PART });
  });
});

describe('assertSameViews on a hidden tile behind the layout check', () => {
  it('other-sheet: refuses the tile', () => {
    const archive = hiddenTileArchive('other-sheet');
    const error = fileErrorOf(() =>
      assertSameViews(archive.file, archive.layout, streamedParts(archive)),
    );
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.VIEW_MISMATCH, entry: SHEET_PART });
  });

  it('bomb: refuses the tile within the bounded-inflate budget', () => {
    const archive = hiddenTileArchive('bomb');
    const parts = streamedParts(archive);
    const started = performance.now();
    const error = fileErrorOf(() => assertSameViews(archive.file, archive.layout, parts));
    // The workbook is two rows; an unbounded inflate of the tile takes more than a second.
    expectWithinBudget(performance.now() - started, BOUNDED_INFLATE_BUDGET_MS);
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toMatchObject({ reason: ZIP_REJECT_REASONS.VIEW_MISMATCH });
  });

  it('same-sheet: the views compare equal', () => {
    // The tile holds the real sheet, so every content comparison passes: the layout
    // rule carries the guarantee, and this check does not.
    const archive = hiddenTileArchive('same-sheet');
    expect(() =>
      assertSameViews(archive.file, archive.layout, streamedParts(archive)),
    ).not.toThrow();
  });
});
