import { describe, expect, it } from 'vitest';

import {
  createPackageCensusCollector,
  isPackageCensus,
  MAX_CENSUS_VALUE_LENGTH,
  MAX_CENSUS_VALUES,
  type PackageCensus,
} from './package-census';

// The census keeps only relationship types and content types of a fixed URI-safe ASCII
// shape; anything else the uploader wrote is flagged and dropped, never returned.

const OFFICE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const BASELINE_RELATIONSHIP_TYPES = [
  `${OFFICE_RELATIONSHIPS}/officeDocument`,
  `${OFFICE_RELATIONSHIPS}/worksheet`,
  `${OFFICE_RELATIONSHIPS}/styles`,
  `${OFFICE_RELATIONSHIPS}/sharedStrings`,
  `${OFFICE_RELATIONSHIPS}/theme`,
  `${OFFICE_RELATIONSHIPS}/calcChain`,
  `${PACKAGE_RELATIONSHIPS}/metadata/core-properties`,
  `${OFFICE_RELATIONSHIPS}/extended-properties`,
];
const WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const XML_CONTENT_TYPE = 'application/xml';
const STRICT_WORKSHEET_TYPE = 'http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet';
const MICROSOFT_TYPE = 'http://schemas.microsoft.com/office/2006/relationships/ui/extensibility';

/** A relationship type of exactly `length` characters on the OOXML host. */
function relationshipTypeOfLength(length: number): string {
  const prefix = `${OFFICE_RELATIONSHIPS}/`;
  return `${prefix}${'a'.repeat(length - prefix.length)}`;
}

/** A content type of exactly `length` characters. */
function contentTypeOfLength(length: number): string {
  const prefix = 'application/';
  return `${prefix}${'a'.repeat(length - prefix.length)}`;
}

function censusOf(
  relationshipTypes: readonly (string | null)[],
  contentTypes: readonly (string | null)[] = [],
): PackageCensus {
  const collector = createPackageCensusCollector();
  for (const type of relationshipTypes) collector.addRelationshipType(type);
  for (const contentType of contentTypes) collector.addContentType(contentType);
  return collector.result();
}

const EMPTY: PackageCensus = {
  relationshipTypes: [],
  contentTypes: [],
  otherRelationshipTypes: false,
  otherContentTypes: false,
  overflow: false,
};

describe('createPackageCensusCollector: relationship types', () => {
  it('counts a Relationship with no Type in the other bucket', () => {
    expect(censusOf([null])).toEqual({ ...EMPTY, otherRelationshipTypes: true });
  });

  it('counts a Default or Override with no ContentType in the other bucket', () => {
    expect(censusOf([], [null])).toEqual({ ...EMPTY, otherContentTypes: true });
  });

  it('keeps the eight baseline types, a strict OOXML type and a Microsoft type', () => {
    const kept = [...BASELINE_RELATIONSHIP_TYPES, STRICT_WORKSHEET_TYPE, MICROSOFT_TYPE];

    expect(censusOf(kept)).toEqual({ ...EMPTY, relationshipTypes: [...kept].sort() });
  });

  it('keeps a type of exactly the maximum length', () => {
    const longest = relationshipTypeOfLength(MAX_CENSUS_VALUE_LENGTH);

    expect(censusOf([longest]).relationshipTypes).toEqual([longest]);
  });

  it.each([
    ['a space', `${OFFICE_RELATIONSHIPS}/work sheet`],
    ['a line break', `${OFFICE_RELATIONSHIPS}/work\nsheet`],
    ['a non-ASCII letter', `${OFFICE_RELATIONSHIPS}/caf\u00e9`],
    ['another host', 'http://example.com/relationships/worksheet'],
    ['a javascript: URI', 'javascript:alert(1)'],
    ['free text', 'private seller note'],
    ['a query string', `${OFFICE_RELATIONSHIPS}/worksheet?x=1`],
    ['a host without a path', 'http://schemas.openxmlformats.org'],
    ['one character too many', relationshipTypeOfLength(MAX_CENSUS_VALUE_LENGTH + 1)],
  ])('drops and flags a type with %s', (_label, type) => {
    const census = censusOf([`${OFFICE_RELATIONSHIPS}/worksheet`, type]);

    expect(census).toEqual({
      ...EMPTY,
      relationshipTypes: [`${OFFICE_RELATIONSHIPS}/worksheet`],
      otherRelationshipTypes: true,
    });
    expect([...census.relationshipTypes, ...census.contentTypes]).not.toContain(type);
  });
});

describe('createPackageCensusCollector: content types', () => {
  it('keeps a plain type/subtype token', () => {
    expect(censusOf([], [WORKBOOK_CONTENT_TYPE, XML_CONTENT_TYPE])).toEqual({
      ...EMPTY,
      contentTypes: [WORKBOOK_CONTENT_TYPE, XML_CONTENT_TYPE],
    });
  });

  it('keeps a content type of exactly the maximum length', () => {
    const longest = contentTypeOfLength(MAX_CENSUS_VALUE_LENGTH);

    expect(censusOf([], [longest]).contentTypes).toEqual([longest]);
  });

  it.each([
    ['a parameter', 'text/html; charset=x'],
    ['an upper-case type', 'Application/xml'],
    ['no subtype', 'application'],
    ['a second slash', 'application/xml/x'],
    ['a non-ASCII letter', 'application/caf\u00e9'],
    ['one character too many', contentTypeOfLength(MAX_CENSUS_VALUE_LENGTH + 1)],
  ])('drops and flags a content type with %s', (_label, contentType) => {
    const census = censusOf([], [XML_CONTENT_TYPE, contentType]);

    expect(census).toEqual({
      ...EMPTY,
      contentTypes: [XML_CONTENT_TYPE],
      otherContentTypes: true,
    });
    expect([...census.relationshipTypes, ...census.contentTypes]).not.toContain(contentType);
  });

  it('flags each kind on its own', () => {
    expect(censusOf(['free text'])).toEqual({ ...EMPTY, otherRelationshipTypes: true });
    expect(censusOf([], ['free text'])).toEqual({ ...EMPTY, otherContentTypes: true });
  });
});

describe('createPackageCensusCollector: distinct values and overflow', () => {
  function contentTypes(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `application/x-${String(i).padStart(3, '0')}`);
  }

  it('returns each value once, sorted', () => {
    const census = censusOf(
      [`${OFFICE_RELATIONSHIPS}/worksheet`, `${OFFICE_RELATIONSHIPS}/styles`],
      [XML_CONTENT_TYPE, WORKBOOK_CONTENT_TYPE, XML_CONTENT_TYPE],
    );

    expect(census.relationshipTypes).toEqual([
      `${OFFICE_RELATIONSHIPS}/styles`,
      `${OFFICE_RELATIONSHIPS}/worksheet`,
    ]);
    expect(census.contentTypes).toEqual([WORKBOOK_CONTENT_TYPE, XML_CONTENT_TYPE]);
  });

  it('keeps the maximum number of distinct values without overflow', () => {
    const values = contentTypes(MAX_CENSUS_VALUES);
    // A repeat of a kept value at the cap is not a new value.
    const census = censusOf([], [...values, values[0] ?? '']);

    expect(census.contentTypes).toEqual(values);
    expect(census.overflow).toBe(false);
  });

  it('sets overflow at one distinct value more and drops it', () => {
    const values = contentTypes(MAX_CENSUS_VALUES + 1);
    const census = censusOf([], values);

    expect(census.contentTypes).toEqual(values.slice(0, MAX_CENSUS_VALUES));
    expect(census.overflow).toBe(true);
    expect(census.otherContentTypes).toBe(false);
  });

  it('flags a malformed value past the cap as other, not as overflow', () => {
    const census = censusOf([], [...contentTypes(MAX_CENSUS_VALUES), 'text/html; charset=x']);

    expect(census.overflow).toBe(false);
    expect(census.otherContentTypes).toBe(true);
  });

  it('sets overflow for relationship types too', () => {
    const types = Array.from(
      { length: MAX_CENSUS_VALUES + 1 },
      (_, i) => `${OFFICE_RELATIONSHIPS}/t${String(i).padStart(3, '0')}`,
    );

    const census = censusOf(types);

    expect(census.relationshipTypes).toHaveLength(MAX_CENSUS_VALUES);
    expect(census.overflow).toBe(true);
  });
});

describe('isPackageCensus', () => {
  const valid: PackageCensus = {
    relationshipTypes: [`${OFFICE_RELATIONSHIPS}/styles`, `${OFFICE_RELATIONSHIPS}/worksheet`],
    contentTypes: [XML_CONTENT_TYPE],
    otherRelationshipTypes: false,
    otherContentTypes: true,
    overflow: false,
  };

  it('accepts what a collector returns', () => {
    expect(isPackageCensus(valid)).toBe(true);
    expect(isPackageCensus(EMPTY)).toBe(true);
    expect(isPackageCensus(censusOf(BASELINE_RELATIONSHIP_TYPES, [XML_CONTENT_TYPE]))).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a missing flag', { ...valid, overflow: undefined }],
    ['a flag that is not a boolean', { ...valid, otherContentTypes: 'yes' }],
    ['values that are not an array', { ...valid, contentTypes: XML_CONTENT_TYPE }],
    ['a value that is not a string', { ...valid, contentTypes: [7] }],
    ['a relationship type the census drops', { ...valid, relationshipTypes: ['free text'] }],
    ['a content type the census drops', { ...valid, contentTypes: ['text/html; charset=x'] }],
    ['a relationship type in the content types', { ...valid, contentTypes: [MICROSOFT_TYPE] }],
    ['unsorted values', { ...valid, relationshipTypes: [...valid.relationshipTypes].reverse() }],
    ['a repeated value', { ...valid, contentTypes: [XML_CONTENT_TYPE, XML_CONTENT_TYPE] }],
    [
      'more values than the cap',
      {
        ...valid,
        contentTypes: Array.from(
          { length: MAX_CENSUS_VALUES + 1 },
          (_, i) => `application/x-${String(i).padStart(3, '0')}`,
        ),
      },
    ],
    // A hole reads as undefined: indexed, not `every`.
    ['a sparse array', { ...valid, contentTypes: new Array<string>(1) }],
  ])('refuses %s', (_label, value) => {
    expect(isPackageCensus(value)).toBe(false);
  });
});
