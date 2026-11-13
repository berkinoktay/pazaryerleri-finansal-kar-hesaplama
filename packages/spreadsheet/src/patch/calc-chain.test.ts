import { describe, expect, it } from 'vitest';

import { expectWithinBudget, LINEAR_BUDGET_MS } from '../../tests/helpers/timing';
import { SpreadsheetFileError } from '../errors';
import { CONTENT_TYPES_PART, WORKBOOK_RELS_PART } from '../workbook-parts';
import { childElements, parsePart } from '../xml-dom';
import { planCalcChainRemoval, type CalcChainRemoval } from './calc-chain';
import { ZIP_REJECT_REASONS } from './reasons';

const encoder = new TextEncoder();
// Keeps a leading byte order mark, so a decoded result can be compared with its source.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

// Built from a code unit so the source file stays ASCII.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const UTF8_BYTE_ORDER_MARK = [0xef, 0xbb, 0xbf];

const OFFICE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKSHEET_TYPE = `${OFFICE_RELATIONSHIPS}/worksheet`;
const CALC_CHAIN_TYPE = `${OFFICE_RELATIONSHIPS}/calcChain`;
const STRICT_CALC_CHAIN_TYPE = 'http://purl.oclc.org/ooxml/officeDocument/relationships/calcChain';
// The calcChain type with its first ':' written as a character reference.
const CALC_CHAIN_TYPE_WITH_REFERENCE = CALC_CHAIN_TYPE.replace(':', '&#58;');
const PACKAGE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WORKSHEET_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const CALC_CHAIN_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const CALC_CHAIN_PATH = 'xl/calcChain.xml';
const WORKSHEET_REL = `<Relationship Id="rId1" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet1.xml"/>`;
const CALC_CHAIN_REL = `<Relationship Id="rId2" Type="${CALC_CHAIN_TYPE}" Target="calcChain.xml"/>`;
const SHEET_OVERRIDE = `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`;
const CALC_CHAIN_OVERRIDE = `<Override PartName="/xl/calcChain.xml" ContentType="${CALC_CHAIN_CONTENT_TYPE}"/>`;

const MANY_ELEMENTS = 200_000;
const CALC_CHAIN_PARTS = 300;
const LINEAR_TEST_TIMEOUT_MS = 120_000;

function relsText(body: string): string {
  return `${DECLARATION}\n<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${body}</Relationships>`;
}

function typesText(body: string): string {
  return (
    `${DECLARATION}\n<Types xmlns="${CONTENT_TYPES_NAMESPACE}">` +
    `<Default Extension="xml" ContentType="application/xml"/>${body}</Types>`
  );
}

function plan(rels: string, types: string): CalcChainRemoval | null {
  return planCalcChainRemoval(encoder.encode(rels), encoder.encode(types));
}

function planned(rels: string, types: string): CalcChainRemoval {
  const result = plan(rels, types);
  if (result === null) throw new Error('Expected a calcChain removal');
  return result;
}

function fileErrorOf(run: () => unknown): SpreadsheetFileError {
  try {
    run();
  } catch (error) {
    if (error instanceof SpreadsheetFileError) return error;
    throw error;
  }
  throw new Error('Expected a SpreadsheetFileError');
}

function expectPackagePartError(entry: string, run: () => unknown): void {
  const error = fileErrorOf(run);
  expect(error.code).toBe('CORRUPT_FILE');
  expect(error.meta).toEqual({ reason: ZIP_REJECT_REASONS.PACKAGE_PART, entry });
}

function contentTypesText(result: CalcChainRemoval): string {
  if (result.contentTypes === null) throw new Error('Expected cut content types');
  return decoder.decode(result.contentTypes);
}

/** [tag name, Id, Type, Target] of each direct child of the rels root. */
function relationshipsOf(rels: Uint8Array): (string | null)[][] {
  const root = parsePart(WORKBOOK_RELS_PART, decoder.decode(rels)).documentElement;
  if (root === null) throw new Error('Rels part has no root');
  return childElements(root).map((element) => [
    element.tagName,
    element.getAttribute('Id'),
    element.getAttribute('Type'),
    element.getAttribute('Target'),
  ]);
}

/** Runs `work` and asserts it stayed within the linear budget (enforced in CI). */
function timed<T>(work: () => T): T {
  const started = performance.now();
  const result = work();
  expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);
  return result;
}

describe('planCalcChainRemoval: cuts', () => {
  it('cuts the calcChain relationship and its Override, and nothing else', () => {
    const rels = relsText(`\n  ${WORKSHEET_REL}\n  ${CALC_CHAIN_REL}\n`);
    const types = typesText(`${SHEET_OVERRIDE}${CALC_CHAIN_OVERRIDE}`);
    const result = planned(rels, types);

    expect(result.paths).toEqual([CALC_CHAIN_PATH]);
    expect(relationshipsOf(result.workbookRels)).toEqual([
      ['Relationship', 'rId1', WORKSHEET_TYPE, 'worksheets/sheet1.xml'],
    ]);
    const cutTypes = contentTypesText(result);
    expect(cutTypes).not.toContain('calcChain');
    expect(decoder.decode(result.workbookRels)).toBe(rels.replace(CALC_CHAIN_REL, ''));
    expect(cutTypes).toBe(types.replace(CALC_CHAIN_OVERRIDE, ''));
  });

  it('returns null when the rels name no calcChain part', () => {
    expect(plan(relsText(WORKSHEET_REL), typesText(SHEET_OVERRIDE))).toBeNull();
  });

  it('never walks the content types when there is nothing to cut', () => {
    const brokenTypes = typesText(
      '<Override PartName="/xl/calc&#67;hain.xml"/><Override PartName=x/><<',
    );
    expect(plan(relsText(WORKSHEET_REL), brokenTypes)).toBeNull();
  });

  it('maps an absolute Target to the same entry name', () => {
    const rel = `<Relationship Id="rId2" Type="${CALC_CHAIN_TYPE}" Target="/xl/calcChain.xml"/>`;
    const result = planned(relsText(rel), typesText(CALC_CHAIN_OVERRIDE));
    expect(result.paths).toEqual([CALC_CHAIN_PATH]);
  });

  it('reports each path once, in document order', () => {
    const absolute = `<Relationship Id="rId3" Type="${CALC_CHAIN_TYPE}" Target="/xl/calcChain.xml"/>`;
    const other = `<Relationship Id="rId4" Type="${CALC_CHAIN_TYPE}" Target="chains/other.xml"/>`;
    const rels = relsText(`${CALC_CHAIN_REL}${WORKSHEET_REL}${absolute}${other}`);
    const result = planned(rels, typesText(CALC_CHAIN_OVERRIDE));

    expect(result.paths).toEqual([CALC_CHAIN_PATH, 'xl/chains/other.xml']);
    expect(decoder.decode(result.workbookRels)).toBe(relsText(WORKSHEET_REL));
  });

  it('cuts the strict calcChain relationship type', () => {
    const rel = `<Relationship Id="rId2" Type="${STRICT_CALC_CHAIN_TYPE}" Target="calcChain.xml"/>`;
    const result = planned(relsText(`${WORKSHEET_REL}${rel}`), typesText(CALC_CHAIN_OVERRIDE));
    expect(result.paths).toEqual([CALC_CHAIN_PATH]);
    expect(decoder.decode(result.workbookRels)).toBe(relsText(WORKSHEET_REL));
  });

  it('cuts every Override of every path', () => {
    const other = `<Relationship Id="rId4" Type="${CALC_CHAIN_TYPE}" Target="chains/other.xml"/>`;
    const otherOverride = `<Override PartName="/xl/chains/other.xml" ContentType="${CALC_CHAIN_CONTENT_TYPE}"/>`;
    const types = typesText(`${CALC_CHAIN_OVERRIDE}${SHEET_OVERRIDE}${otherOverride}`);
    const result = planned(relsText(`${CALC_CHAIN_REL}${other}`), types);
    expect(contentTypesText(result)).toBe(typesText(SHEET_OVERRIDE));
  });

  it('leaves the content types null when no Override names a path, and still cuts the rels', () => {
    const result = planned(
      relsText(`${WORKSHEET_REL}${CALC_CHAIN_REL}`),
      typesText(SHEET_OVERRIDE),
    );
    expect(result.paths).toEqual([CALC_CHAIN_PATH]);
    expect(result.contentTypes).toBeNull();
    expect(decoder.decode(result.workbookRels)).toBe(relsText(WORKSHEET_REL));
  });

  it('cuts a prefixed Relationship but not one inside a comment', () => {
    const prefixed = `<pr:Relationship xmlns:pr="${PACKAGE_RELATIONSHIPS}" Id="rId2" Type="${CALC_CHAIN_TYPE}" Target="calcChain.xml"/>`;
    const commented = `<!--<Relationship Id="rId3" Type="${CALC_CHAIN_TYPE}" Target="hidden.xml"/>-->`;
    const rels = relsText(`${WORKSHEET_REL}${prefixed}${commented}`);
    const result = planned(rels, typesText(CALC_CHAIN_OVERRIDE));

    expect(result.paths).toEqual([CALC_CHAIN_PATH]);
    expect(decoder.decode(result.workbookRels)).toBe(relsText(`${WORKSHEET_REL}${commented}`));
  });

  it('cuts a Relationship with an end tag up to that end tag', () => {
    const rel = `<Relationship Id="rId2" Type="${CALC_CHAIN_TYPE}" Target="calcChain.xml"><x><y/></x></Relationship>`;
    const result = planned(relsText(`${rel}${WORKSHEET_REL}`), typesText(CALC_CHAIN_OVERRIDE));
    expect(decoder.decode(result.workbookRels)).toBe(relsText(WORKSHEET_REL));
  });

  it('cuts only direct children of the root', () => {
    const nestedRel = `<Group>${CALC_CHAIN_REL}</Group>`;
    expect(plan(relsText(`${WORKSHEET_REL}${nestedRel}`), typesText(''))).toBeNull();

    const nestedOverride = `<Group>${CALC_CHAIN_OVERRIDE}</Group>`;
    const result = planned(relsText(CALC_CHAIN_REL), typesText(nestedOverride));
    expect(result.contentTypes).toBeNull();
  });

  it('reads the Target of a non-calcChain relationship as it is', () => {
    const referenced = `<Relationship Id="rId1" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet&#49;.xml"/>`;
    const result = planned(relsText(`${referenced}${CALC_CHAIN_REL}`), typesText(''));
    expect(result.paths).toEqual([CALC_CHAIN_PATH]);
  });

  it('keeps a leading byte order mark in both results', () => {
    const rels = BYTE_ORDER_MARK + relsText(`${WORKSHEET_REL}${CALC_CHAIN_REL}`);
    const types = BYTE_ORDER_MARK + typesText(`${SHEET_OVERRIDE}${CALC_CHAIN_OVERRIDE}`);
    const result = planned(rels, types);

    expect(result.paths).toEqual([CALC_CHAIN_PATH]);
    expect(decoder.decode(result.workbookRels)).toBe(rels.replace(CALC_CHAIN_REL, ''));
    expect(contentTypesText(result)).toBe(types.replace(CALC_CHAIN_OVERRIDE, ''));
    expect([...result.workbookRels.subarray(0, UTF8_BYTE_ORDER_MARK.length)]).toEqual(
      UTF8_BYTE_ORDER_MARK,
    );
    expect([...(result.contentTypes ?? []).slice(0, UTF8_BYTE_ORDER_MARK.length)]).toEqual(
      UTF8_BYTE_ORDER_MARK,
    );
  });
});

describe('planCalcChainRemoval: refusals', () => {
  it('refuses a rels part outside the strict lexer subset', () => {
    const rels = relsText(
      `<Relationship Id=rId2 Type="${CALC_CHAIN_TYPE}" Target="calcChain.xml"/>`,
    );
    expectPackagePartError(WORKBOOK_RELS_PART, () => plan(rels, typesText('')));
  });

  it('refuses a content types part outside the strict lexer subset', () => {
    const types = typesText('<Override PartName=/xl/calcChain.xml/>');
    expectPackagePartError(CONTENT_TYPES_PART, () => plan(relsText(CALC_CHAIN_REL), types));
  });

  it.each([
    ['an end tag outside the root', `${relsText(CALC_CHAIN_REL)}</Relationships>`],
    ['a second root element', `${relsText(CALC_CHAIN_REL)}<Relationships/>`],
    ['an unclosed root', relsText(CALC_CHAIN_REL).replace('</Relationships>', '')],
  ])('refuses a rels part with %s', (_shape, rels) => {
    expectPackagePartError(WORKBOOK_RELS_PART, () => plan(rels, typesText('')));
  });

  it('refuses a content types part whose root never closes', () => {
    const types = typesText(CALC_CHAIN_OVERRIDE).replace('</Types>', '');
    expectPackagePartError(CONTENT_TYPES_PART, () => plan(relsText(CALC_CHAIN_REL), types));
  });

  it('refuses a relationship Type holding a character reference', () => {
    const rel = `<Relationship Id="rId2" Type="${CALC_CHAIN_TYPE_WITH_REFERENCE}" Target="calcChain.xml"/>`;
    expectPackagePartError(WORKBOOK_RELS_PART, () => plan(relsText(rel), typesText('')));
  });

  it('refuses a non-calcChain Type holding a reference, which cannot be classified by bytes', () => {
    const rel = `<Relationship Id="rId1" Type="${WORKSHEET_TYPE}&amp;" Target="worksheets/sheet1.xml"/>`;
    expectPackagePartError(WORKBOOK_RELS_PART, () =>
      plan(relsText(`${rel}${CALC_CHAIN_REL}`), typesText('')),
    );
  });

  it('refuses a calcChain Target holding a character reference', () => {
    const rel = `<Relationship Id="rId2" Type="${CALC_CHAIN_TYPE}" Target="calc&#67;hain.xml"/>`;
    expectPackagePartError(WORKBOOK_RELS_PART, () => plan(relsText(rel), typesText('')));
  });

  it('refuses a calcChain Target holding a tab, which XML reads as a space', () => {
    const rel = `<Relationship Id="rId2" Type="${CALC_CHAIN_TYPE}" Target="calc\tChain.xml"/>`;
    expectPackagePartError(WORKBOOK_RELS_PART, () => plan(relsText(rel), typesText('')));
  });

  it('refuses a calcChain relationship without a Target', () => {
    const rel = `<Relationship Id="rId2" Type="${CALC_CHAIN_TYPE}"/>`;
    expectPackagePartError(WORKBOOK_RELS_PART, () => plan(relsText(rel), typesText('')));
  });

  it('refuses an Override PartName holding a character reference', () => {
    const override = `<Override PartName="/xl/worksheets/sheet&#49;.xml" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`;
    expectPackagePartError(CONTENT_TYPES_PART, () =>
      plan(relsText(CALC_CHAIN_REL), typesText(`${override}${CALC_CHAIN_OVERRIDE}`)),
    );
  });

  it('refuses an Override PartName holding a line feed, which XML reads as a space', () => {
    const override = `<Override PartName="/xl/calc\nChain.xml" ContentType="${CALC_CHAIN_CONTENT_TYPE}"/>`;
    expectPackagePartError(CONTENT_TYPES_PART, () =>
      plan(relsText(CALC_CHAIN_REL), typesText(override)),
    );
  });

  it('refuses a Relationship with a repeated Type', () => {
    const rel = `<Relationship Id="rId2" Type="${WORKSHEET_TYPE}" Type="${CALC_CHAIN_TYPE}" Target="calcChain.xml"/>`;
    expectPackagePartError(WORKBOOK_RELS_PART, () => plan(relsText(rel), typesText('')));
  });

  it('refuses a Relationship with a repeated Target', () => {
    const rel = `<Relationship Id="rId2" Type="${CALC_CHAIN_TYPE}" Target="calcChain.xml" Target="other.xml"/>`;
    expectPackagePartError(WORKBOOK_RELS_PART, () => plan(relsText(rel), typesText('')));
  });

  it('refuses an Override with a repeated PartName', () => {
    const override = `<Override PartName="/xl/worksheets/sheet1.xml" PartName="/xl/calcChain.xml" ContentType="${CALC_CHAIN_CONTENT_TYPE}"/>`;
    expectPackagePartError(CONTENT_TYPES_PART, () =>
      plan(relsText(CALC_CHAIN_REL), typesText(override)),
    );
  });
});

describe('planCalcChainRemoval: linear time', { timeout: LINEAR_TEST_TIMEOUT_MS }, () => {
  it('finds the calcChain behind 200 000 relationships', () => {
    const others = Array.from(
      { length: MANY_ELEMENTS - 1 },
      (_, position) =>
        `<Relationship Id="rId${position + 3}" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet${position + 1}.xml"/>`,
    ).join('');
    const rels = relsText(`${others}${CALC_CHAIN_REL}`);
    const result = timed(() => planned(rels, typesText(CALC_CHAIN_OVERRIDE)));

    expect(result.paths).toEqual([CALC_CHAIN_PATH]);
    expect(result.workbookRels.length).toBe(encoder.encode(relsText(others)).length);
    expect(contentTypesText(result)).toBe(typesText(''));
  });

  it('matches 300 calcChain parts against 200 000 Override elements', () => {
    const chainRels = Array.from(
      { length: CALC_CHAIN_PARTS },
      (_, position) =>
        `<Relationship Id="rId${position + 1}" Type="${CALC_CHAIN_TYPE}" Target="chains/chain${position + 1}.xml"/>`,
    ).join('');
    const sheetOverrides = Array.from(
      { length: MANY_ELEMENTS - CALC_CHAIN_PARTS },
      (_, position) =>
        `<Override PartName="/xl/worksheets/sheet${position + 1}.xml" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`,
    ).join('');
    const chainOverrides = Array.from(
      { length: CALC_CHAIN_PARTS },
      (_, position) =>
        `<Override PartName="/xl/chains/chain${position + 1}.xml" ContentType="${CALC_CHAIN_CONTENT_TYPE}"/>`,
    ).join('');
    const types = typesText(`${sheetOverrides}${chainOverrides}`);
    const result = timed(() => planned(relsText(`${WORKSHEET_REL}${chainRels}`), types));

    expect(result.paths).toHaveLength(CALC_CHAIN_PARTS);
    expect(decoder.decode(result.workbookRels)).toBe(relsText(WORKSHEET_REL));
    expect(contentTypesText(result)).toBe(typesText(sheetOverrides));
  });
});
