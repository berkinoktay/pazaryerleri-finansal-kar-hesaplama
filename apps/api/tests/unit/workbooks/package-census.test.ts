import type { PackageCensus } from '@pazarsync/spreadsheet';
import { describe, expect, it } from 'vitest';

import {
  addCensus,
  addNotCensused,
  addRefused,
  BASELINE_RELATIONSHIP_TYPE_ENDINGS,
  censusLines,
  createCensusTally,
  type CensusTally,
} from '@/workbooks/package-census';

const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OFFICE_DOCUMENT = `${OFFICE_REL}/officeDocument`;
const WORKSHEET = `${OFFICE_REL}/worksheet`;
const STYLES = `${OFFICE_REL}/styles`;
const CORE_PROPERTIES =
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties';
const RICH_DATA = 'http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue';
const XML = 'application/xml';
const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

const EMPTY: PackageCensus = {
  relationshipTypes: [],
  contentTypes: [],
  otherRelationshipTypes: false,
  otherContentTypes: false,
  overflow: false,
};

function tallyOf(censuses: readonly PackageCensus[], refused = 0): CensusTally {
  const tally = createCensusTally();
  for (const census of censuses) addCensus(tally, census);
  for (let i = 0; i < refused; i += 1) addRefused(tally);
  return tally;
}

describe('BASELINE_RELATIONSHIP_TYPE_ENDINGS', () => {
  it('lists the eight endings the real Trendyol files carry', () => {
    expect([...BASELINE_RELATIONSHIP_TYPE_ENDINGS].sort()).toEqual(
      [
        'calcChain',
        'core-properties',
        'extended-properties',
        'officeDocument',
        'sharedStrings',
        'styles',
        'theme',
        'worksheet',
      ].sort(),
    );
  });
});

describe('censusLines', () => {
  it('prints the denominator and the empty sections of an empty tally', () => {
    expect(censusLines(createCensusTally())).toEqual([
      'files censused 0, refused by the gate 0, not censused (queue busy or a worker limit) 0',
      'relationship types:',
      'content types:',
    ]);
  });

  it('counts a file the engine could not census apart from a gate refusal', () => {
    const tally = tallyOf([], 1);
    addNotCensused(tally);
    addNotCensused(tally);

    expect(censusLines(tally)[0]).toBe(
      'files censused 0, refused by the gate 1, not censused (queue busy or a worker limit) 2',
    );
  });

  it('counts files, not occurrences', () => {
    const tally = tallyOf(
      [
        { ...EMPTY, relationshipTypes: [OFFICE_DOCUMENT, WORKSHEET], contentTypes: [XML] },
        { ...EMPTY, relationshipTypes: [WORKSHEET], contentTypes: [XML, WORKBOOK] },
        // The type allows a repeat; it is still one file.
        { ...EMPTY, relationshipTypes: [WORKSHEET, WORKSHEET] },
      ],
      2,
    );

    expect(censusLines(tally)).toEqual([
      'files censused 3, refused by the gate 2, not censused (queue busy or a worker limit) 0',
      'relationship types:',
      `  ${OFFICE_DOCUMENT}: 1`,
      `  ${WORKSHEET}: 3`,
      'content types:',
      `  ${WORKBOOK}: 1`,
      `  ${XML}: 2`,
    ]);
  });

  it('marks a relationship type whose last segment is outside the baseline', () => {
    const tally = tallyOf([{ ...EMPTY, relationshipTypes: [CORE_PROPERTIES, RICH_DATA] }]);

    expect(censusLines(tally)).toEqual([
      'files censused 1, refused by the gate 0, not censused (queue busy or a worker limit) 0',
      'relationship types:',
      `  ${RICH_DATA}: 1 (outside the baseline)`,
      `  ${CORE_PROPERTIES}: 1`,
      'content types:',
    ]);
  });

  it('prints the other and overflow buckets only when a file carries them', () => {
    const tally = tallyOf([
      { ...EMPTY, otherRelationshipTypes: true, overflow: true },
      { ...EMPTY, otherRelationshipTypes: true, otherContentTypes: true },
      EMPTY,
    ]);

    expect(censusLines(tally)).toEqual([
      'files censused 3, refused by the gate 0, not censused (queue busy or a worker limit) 0',
      'relationship types:',
      '  other (dropped by the census, never printed): 2',
      'content types:',
      '  other (dropped by the census, never printed): 1',
      'files with more distinct values of one kind than the census keeps: 1',
    ]);
    expect(censusLines(tallyOf([{ ...EMPTY, otherContentTypes: true }]))).toEqual([
      'files censused 1, refused by the gate 0, not censused (queue busy or a worker limit) 0',
      'relationship types:',
      'content types:',
      '  other (dropped by the census, never printed): 1',
    ]);
  });

  it('prints the same lines whatever order the files came in', () => {
    const first: PackageCensus = {
      ...EMPTY,
      relationshipTypes: [WORKSHEET, STYLES],
      contentTypes: [XML],
    };
    const second: PackageCensus = {
      ...EMPTY,
      relationshipTypes: [OFFICE_DOCUMENT, RICH_DATA],
      contentTypes: [WORKBOOK],
    };

    const lines = censusLines(tallyOf([first, second]));

    expect(censusLines(tallyOf([second, first]))).toEqual(lines);
    // Sorted by UTF-16 code unit: the Microsoft host before the OOXML one.
    expect(lines.slice(2, 6)).toEqual([
      `  ${RICH_DATA}: 1 (outside the baseline)`,
      `  ${OFFICE_DOCUMENT}: 1`,
      `  ${STYLES}: 1`,
      `  ${WORKSHEET}: 1`,
    ]);
  });
});
