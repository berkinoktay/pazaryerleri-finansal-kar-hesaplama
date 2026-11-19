import { strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../tests/helpers/errors';
import { FIXTURE_PINS, readFixture } from '../tests/helpers/fixture-pins';
import {
  CONTENT_TYPES_PART,
  contentTypesXml,
  PACKAGE_PART_CASES,
  SAFE_PART_CASES,
  type PackagePartCase,
  SHEET_PART,
  UNSAFE_PART_CASES,
  WORKBOOK_RELS_PART,
  workbookRels,
  WORKSHEET_XML,
} from '../tests/helpers/package-parts';
import { entryContentKind, type ExternalHyperlinkIds } from './content-scan';
import {
  isUnsafeContentDetail,
  UNSAFE_CONTENT_DETAILS,
  UNSAFE_CONTENT_REASONS,
  ZIP_REJECT_REASONS,
} from './patch/reasons';
import {
  assertNoUnsafePackageParts,
  assertNoUnsafePartNames,
  contentScanPlan,
  isRelationshipsPartName,
  UNSAFE_CONTENT_TYPE_MARKERS,
  UNSAFE_RELATIONSHIP_TYPE_ENDINGS,
} from './unsafe-parts';

const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET_RELS_PART = 'xl/worksheets/_rels/sheet1.xml.rels';
const DRAWING_RELS_PART = 'xl/drawings/_rels/drawing1.xml.rels';
const ROOT_RELS_PART = '_rels/.rels';

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

/** The case of UNSAFE_PART_CASES labelled `label`. */
function unsafePartCase(label: string): PackagePartCase {
  const found = UNSAFE_PART_CASES.find((testCase) => testCase.label === label);
  if (found === undefined) throw new Error(`No unsafe part case is labelled ${label}`);
  return found;
}

describe('assertNoUnsafePackageParts', () => {
  it.each(UNSAFE_PART_CASES)('refuses $label as UNSAFE_CONTENT', ({ entries }) => {
    const error = fileErrorOf(() => checkEntries(entries));
    expect(error.code).toBe('UNSAFE_CONTENT');
    expect(error.meta).toMatchObject({ reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART });
    expect(isUnsafeContentDetail(error.meta['detail'])).toBe(true);
  });

  // Each package check names itself (`meta.detail`), so a log tells a macro or an
  // external link from a false positive of the content scan's CSS rule.
  it.each([
    [
      'a workbook relationship of the Microsoft vbaProject type',
      UNSAFE_CONTENT_DETAILS.ACTIVE_RELATIONSHIP,
      WORKBOOK_RELS_PART,
    ],
    [
      'a macro-enabled workbook Override',
      UNSAFE_CONTENT_DETAILS.ACTIVE_CONTENT_TYPE,
      CONTENT_TYPES_PART,
    ],
    [
      'a drawing image relationship to a file share with TargetMode="External"',
      UNSAFE_CONTENT_DETAILS.EXTERNAL_TARGET,
      DRAWING_RELS_PART,
    ],
    [
      'an image relationship with TargetMode="Internal" to a web address',
      UNSAFE_CONTENT_DETAILS.ABSOLUTE_TARGET,
      DRAWING_RELS_PART,
    ],
    [
      'a digital signature origin named by the root relationships',
      UNSAFE_CONTENT_DETAILS.DIGITAL_SIGNATURE,
      ROOT_RELS_PART,
    ],
  ])('names %s %s', (label, detail, entry) => {
    const error = fileErrorOf(() => checkEntries(unsafePartCase(label).entries));
    expect(error.code).toBe('UNSAFE_CONTENT');
    expect(error.meta).toEqual({ reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART, detail, entry });
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
  it('returns the ids a worksheet relationships part gives an external hyperlink, only or among others', () => {
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
      relationship('rId5', 'hyperlink', 'mailto:a@example.com', external) +
      '</Relationships>';

    expect(checkEntries({ [SHEET_RELS_PART]: sheetRels })).toEqual(
      new Map([
        [
          SHEET_PART,
          { onlyExternal: new Set(['rId1', 'rId5']), external: new Set(['rId1', 'rId4', 'rId5']) },
        ],
      ]),
    );
    expect(checkEntries({})).toEqual(new Map());
  });

  // The content scan compares the Id with the ids a worksheet names, so it is read
  // literally: a reference or a white space character XML would replace refuses.
  it.each([
    ['a character reference', 'rId&#49;'],
    ['a TAB', 'rId\t1'],
    ['an LF', 'rId\n1'],
    ['a CR', 'rId\r1'],
  ])('refuses a relationship Id holding %s as CORRUPT_FILE package-part', (_label, id) => {
    const sheetRels =
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${RELATIONSHIPS_NS}">` +
      `<Relationship Id="${id}" Type="${OFFICE_REL}/hyperlink" Target="https://example.com/a" TargetMode="External"/>` +
      '</Relationships>';

    const error = fileErrorOf(() => checkEntries({ [SHEET_RELS_PART]: sheetRels }));
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.PACKAGE_PART, entry: SHEET_RELS_PART });
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

// Each kept XML part gets one content scan: the package walk scans the parts it walks,
// chosen by name or by root element, and the content scan of the gate skips them. The
// root relationships part is not a kept entry; the root relationships rule scans it.
describe('contentScanPlan', () => {
  const RELATIONSHIPS_ROOT = `<Relationships xmlns="${RELATIONSHIPS_NS}"/>`;
  const OTHER_ROOT = '<a/>';

  it.each([
    [
      'a .rels name with a Relationships root',
      'xl/x/_rels/a.xml.rels',
      RELATIONSHIPS_ROOT,
      'package-walk',
    ],
    ['a .rels name with another root', 'xl/x/_rels/a.xml.rels', OTHER_ROOT, 'package-walk'],
    ['another name with a Relationships root', 'xl/x/a.xml', RELATIONSHIPS_ROOT, 'package-walk'],
    [
      'another name with a relationships root in another ASCII case',
      'xl/x/a.xml',
      '<RELATIONSHIPS/>',
      'package-walk',
    ],
    ['the content types part', CONTENT_TYPES_PART, contentTypesXml(), 'package-walk'],
    ['another name with another root', 'xl/x/a.xml', OTHER_ROOT, 'content-scan'],
    ['the worksheet', SHEET_PART, WORKSHEET_XML, 'content-scan'],
  ])('gives %s one scan', (_label, name, xml, step) => {
    expect(contentScanPlan(new Map([[name, strToU8(xml)]]))).toEqual(new Map([[name, step]]));
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
    expect(error.meta).toEqual({
      reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART,
      detail: UNSAFE_CONTENT_DETAILS.ACTIVE_PART_NAME,
      entry: name,
    });
  });

  it.each(['xl/media/image1.png', 'xl/x/a.xml', 'xl/externalLinksIndex.xml', 'xl/embeddings.xml'])(
    'accepts %s',
    (name) => {
      expect(() => assertNoUnsafePartNames([name])).not.toThrow();
    },
  );
});
