import { strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../tests/helpers/errors';
import { FIXTURE_PINS, readFixture } from '../tests/helpers/fixture-pins';
import {
  CONTENT_TYPES_PART,
  contentTypesXml,
  PACKAGE_PART_CASES,
  SAFE_PART_CASES,
  SHEET_PART,
  UNSAFE_PART_CASES,
  WORKBOOK_RELS_PART,
  workbookRels,
  WORKSHEET_XML,
} from '../tests/helpers/package-parts';
import { entryContentKind, type ExternalHyperlinkIds } from './content-scan';
import { UNSAFE_CONTENT_REASONS, ZIP_REJECT_REASONS } from './patch/reasons';
import {
  assertNoUnsafePackageParts,
  assertNoUnsafePartNames,
  isRelationshipsPartName,
  UNSAFE_CONTENT_TYPE_MARKERS,
  UNSAFE_RELATIONSHIP_TYPE_ENDINGS,
} from './unsafe-parts';

const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET_RELS_PART = 'xl/worksheets/_rels/sheet1.xml.rels';

/** Whether the gate's stream keeps the content of an entry: it holds XML, whatever its name. */
function isKept(content: Uint8Array): boolean {
  return entryContentKind(content) === 'xml';
}

/**
 * The type rule on a minimal package (content types, workbook rels and the worksheet)
 * plus `entries`: the name of every entry, the content of those the gate's stream keeps.
 * Returns the external hyperlink ids the rule read.
 */
function checkEntries(entries: Readonly<Record<string, string>>): ExternalHyperlinkIds {
  const all: Record<string, string> = {
    [CONTENT_TYPES_PART]: contentTypesXml(),
    [WORKBOOK_RELS_PART]: workbookRels(),
    [SHEET_PART]: WORKSHEET_XML,
    ...entries,
  };
  const contents = new Map<string, Uint8Array>();
  for (const [name, text] of Object.entries(all)) {
    const content = strToU8(text);
    if (isKept(content)) contents.set(name, content);
  }
  return assertNoUnsafePackageParts(Object.keys(all), contents);
}

describe('assertNoUnsafePackageParts', () => {
  it.each(UNSAFE_PART_CASES)('refuses $label as UNSAFE_CONTENT', ({ entries }) => {
    const error = fileErrorOf(() => checkEntries(entries));
    expect(error.code).toBe('UNSAFE_CONTENT');
    expect(error.meta).toMatchObject({ reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART });
  });

  it.each(PACKAGE_PART_CASES)('refuses $label as CORRUPT_FILE', ({ entries }) => {
    const error = fileErrorOf(() => checkEntries(entries));
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toMatchObject({ reason: ZIP_REJECT_REASONS.PACKAGE_PART });
  });

  it.each(SAFE_PART_CASES)('accepts $label', ({ entries }) => {
    expect(() => checkEntries(entries)).not.toThrow();
  });

  it.each(FIXTURE_PINS)('accepts the package parts of $file', (pin) => {
    const entries = unzipSync(new Uint8Array(readFixture(pin.file)));
    const contents = new Map(Object.entries(entries).filter(([, content]) => isKept(content)));
    expect(() => assertNoUnsafePackageParts(Object.keys(entries), contents)).not.toThrow();
  });

  // The content scan reads a hyperlink's location as a URL fragment only for these ids.
  it('returns the ids a worksheet relationships part gives an external hyperlink and nothing else', () => {
    const relationship = (id: string, type: string, target: string, mode = ''): string =>
      `<Relationship Id="${id}" Type="${OFFICE_REL}/${type}" Target="${target}"${mode}/>`;
    const external = ' TargetMode="External"';
    const sheetRels =
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${RELATIONSHIPS_NS}">` +
      relationship('rId1', 'hyperlink', 'https://example.com/a', external) +
      relationship('rId2', 'hyperlink', '#Sheet1!A1') +
      relationship('rId3', 'image', '../media/image1.png') +
      relationship('rId4', 'hyperlink', 'https://example.com/b', external) +
      relationship('rId4', 'image', '../media/image1.png') +
      relationship('rId&#53;', 'hyperlink', 'mailto:a@example.com', external) +
      '</Relationships>';

    expect(checkEntries({ [SHEET_RELS_PART]: sheetRels })).toEqual(
      new Map([[SHEET_PART, new Set(['rId1', 'rId5'])]]),
    );
    expect(checkEntries({})).toEqual(new Map());
  });

  // The lexer refuses a DOCTYPE too; the content scan runs first, so it keeps its code.
  it('refuses a DOCTYPE in a part it walks as UNSAFE_CONTENT', () => {
    const types = contentTypesXml().replace('<Types', '<!DOCTYPE t [<!ENTITY x "y">]><Types');
    expect(fileErrorOf(() => checkEntries({ [CONTENT_TYPES_PART]: types })).code).toBe(
      'UNSAFE_CONTENT',
    );
  });

  it('pins the content type markers and the relationship type endings', () => {
    expect(UNSAFE_CONTENT_TYPE_MARKERS).toEqual([
      'vbaproject',
      'macroenabled',
      'externallink',
      'oleobject',
      'activex',
      'macrosheet',
      'dialogsheet',
      'connections+xml',
      'querytable+xml',
      'webextension',
      'customui',
      'xmlmaps',
    ]);
    expect(UNSAFE_RELATIONSHIP_TYPE_ENDINGS).toEqual([
      'vbaproject',
      'externallink',
      'oleobject',
      'package',
      'control',
      'xlmacrosheet',
      'dialogsheet',
      'xlintlmacrosheet',
      'connections',
      'querytable',
      'webextension',
      'webextensiontaskpanes',
      'extensibility',
      'attachedtoolbars',
      'xmlmaps',
    ]);
  });
});

describe('isRelationshipsPartName', () => {
  it.each([
    ['xl/worksheets/_rels/sheet1.xml.rels', true],
    ['xl/charts/_rels/chart1.bin.rels', true],
    ['xl/_rels/vbaData.rels', true],
    ['xl/worksheets/_rels/sheet1.xml.RELS', true],
    ['_rels/.rels', true],
    ['xl/workbook.xml', false],
    ['xl/media/a.relsx', false],
    ['xl/media/rels', false],
  ])('reads %s as a relationships part: %s', (name, expected) => {
    expect(isRelationshipsPartName(name)).toBe(expected);
  });
});

describe('assertNoUnsafePartNames', () => {
  it.each([
    'xl/vbaProject.bin',
    'XL/VBAPROJECT.BIN',
    'xl/externalLinks/externalLink1.xml',
    'xl/embeddings/oleObject1.bin',
  ])('refuses %s as UNSAFE_CONTENT', (name) => {
    const error = fileErrorOf(() => assertNoUnsafePartNames(['xl/workbook.xml', name]));
    expect(error.code).toBe('UNSAFE_CONTENT');
    expect(error.meta).toEqual({ reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART, entry: name });
  });

  it.each(['xl/media/image1.png', 'xl/x/a.xml', 'xl/externalLinksIndex.xml', 'xl/embeddings.xml'])(
    'accepts %s',
    (name) => {
      expect(() => assertNoUnsafePartNames([name])).not.toThrow();
    },
  );
});
