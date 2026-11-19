import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../tests/helpers/errors';
import { FIXTURE_PINS, readFixture } from '../tests/helpers/fixture-pins';
import { openUpload } from './guards';
import { UNSAFE_CONTENT_DETAILS } from './patch/reasons';
import { readUploadCensus } from './read-grid';
import { resolveReadOptions } from './read-options';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';

// The census through the upload gate: the gate records the types where it reads them,
// the root relationships part included, and a file it refuses yields no census.

const options = resolveReadOptions({});
const GUARD_OPTS = {
  rowCap: options.rowCap,
  colCap: options.colCap,
  maxBytes: options.maxBytes,
};
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const VBA_PROJECT_REL = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';
const ROOT_RELS_PART = '_rels/.rels';
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
// The last segments of the relationship types the real Trendyol files carry.
const BASELINE_ENDINGS = new Set([
  'officeDocument',
  'worksheet',
  'styles',
  'sharedStrings',
  'theme',
  'calcChain',
  'core-properties',
  'extended-properties',
]);
const PROPERTIES_ENDINGS = ['core-properties', 'extended-properties'];
const COMMISSION_FIXTURE = 'trendyol-commission-tariff.xlsx';
// Free text in a relationship Type: the gate accepts it, the census never returns it.
const FREE_TEXT_TYPE = 'private seller note 42';
const SHEET_ROWS = [['Barkod'], ['B1']];

function lastSegment(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

function relationshipsXml(...relationships: readonly string[]): string {
  return (
    `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">` +
    `${relationships.join('')}</Relationships>`
  );
}

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
}

const SHEET_RELATIONSHIP = relationship('rId1', `${OFFICE_REL}/worksheet`, 'worksheets/sheet1.xml');
const OFFICE_DOCUMENT_RELATIONSHIP = relationship(
  'rId1',
  `${OFFICE_REL}/officeDocument`,
  'xl/workbook.xml',
);

function oneSheetFile(extraEntries: Readonly<Record<string, string>> = {}): Buffer {
  return buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml(SHEET_ROWS) }], extraEntries);
}

describe('readUploadCensus: real Trendyol files', () => {
  it.each(FIXTURE_PINS)('$file carries only baseline relationship types', ({ file }) => {
    const census = readUploadCensus(readFixture(file), options);
    const endings = census.relationshipTypes.map(lastSegment);

    for (const ending of endings) expect(BASELINE_ENDINGS).toContain(ending);
    expect(endings).toEqual(expect.arrayContaining(['officeDocument', 'worksheet', 'styles']));
    expect(census.contentTypes).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    );
    expect(census).toMatchObject({
      otherRelationshipTypes: false,
      otherContentTypes: false,
      overflow: false,
    });
  });

  // One fixture without properties parts (the discount file) names only the workbook
  // in its root relationships; the commission file names both properties parts there.
  it('records the root relationship types of the commission file', () => {
    const census = readUploadCensus(readFixture(COMMISSION_FIXTURE), options);
    const endings = census.relationshipTypes.map(lastSegment);

    // Only the root relationships part names the properties parts: this proves its hook.
    expect(endings.some((ending) => PROPERTIES_ENDINGS.includes(ending))).toBe(true);
    expect(endings).toContain('officeDocument');
  });
});

describe('readUploadCensus: built files', () => {
  it('records the root, workbook and content types of a minimal workbook', () => {
    expect(readUploadCensus(oneSheetFile(), options)).toEqual({
      relationshipTypes: [`${OFFICE_REL}/officeDocument`, `${OFFICE_REL}/worksheet`],
      contentTypes: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
        'application/vnd.openxmlformats-package.relationships+xml',
        'application/xml',
      ],
      otherRelationshipTypes: false,
      otherContentTypes: false,
      overflow: false,
    });
  });

  it.each([
    [
      'the workbook relationships part',
      {
        [WORKBOOK_RELS_PART]: relationshipsXml(
          SHEET_RELATIONSHIP,
          relationship('rId9', FREE_TEXT_TYPE, 'notes.xml'),
        ),
      },
    ],
    [
      'the root relationships part',
      {
        [ROOT_RELS_PART]: relationshipsXml(
          OFFICE_DOCUMENT_RELATIONSHIP,
          relationship('rId9', FREE_TEXT_TYPE, 'notes.xml'),
        ),
      },
    ],
  ])('accepts a free-text relationship type in %s and never returns it', (_label, entries) => {
    const file = oneSheetFile(entries);
    // The gate accepts the file: the census below is of an accepted upload.
    expect(() => openUpload(file, GUARD_OPTS)).not.toThrow();

    const census = readUploadCensus(file, options);

    expect(census.otherRelationshipTypes).toBe(true);
    expect(census.relationshipTypes).toEqual([
      `${OFFICE_REL}/officeDocument`,
      `${OFFICE_REL}/worksheet`,
    ]);
    expect(JSON.stringify(census)).not.toContain(FREE_TEXT_TYPE);
  });

  it.each([
    [
      'the workbook relationships part',
      {
        [WORKBOOK_RELS_PART]: relationshipsXml(
          SHEET_RELATIONSHIP,
          '<Relationship Id="rId9" Target="notes.xml"/>',
        ),
      },
    ],
    [
      'the root relationships part',
      {
        [ROOT_RELS_PART]: relationshipsXml(
          OFFICE_DOCUMENT_RELATIONSHIP,
          '<Relationship Id="rId9" Target="notes.xml"/>',
        ),
      },
    ],
  ])('counts a relationship with no Type in %s as other', (_label, entries) => {
    const file = oneSheetFile(entries);
    expect(() => openUpload(file, GUARD_OPTS)).not.toThrow();

    const census = readUploadCensus(file, options);

    expect(census.otherRelationshipTypes).toBe(true);
    expect(census.relationshipTypes).toEqual([
      `${OFFICE_REL}/officeDocument`,
      `${OFFICE_REL}/worksheet`,
    ]);
  });

  it('throws the gate refusal and returns no census', () => {
    const macro = oneSheetFile({
      [WORKBOOK_RELS_PART]: relationshipsXml(
        SHEET_RELATIONSHIP,
        relationship('rId9', VBA_PROJECT_REL, 'vbaProject.bin'),
      ),
    });

    const unsafe = fileErrorOf(() => readUploadCensus(macro, options));
    expect(unsafe.code).toBe('UNSAFE_CONTENT');
    expect(unsafe.meta['detail']).toBe(UNSAFE_CONTENT_DETAILS.ACTIVE_RELATIONSHIP);
    expect(fileErrorOf(() => readUploadCensus(Buffer.from([1, 2, 3, 4]), options)).code).toBe(
      'NOT_XLSX',
    );
  });
});
