import { strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { fileErrorOf } from '../tests/helpers/errors';
import { FIXTURE_PINS, readFixture } from '../tests/helpers/fixture-pins';
import {
  CONTENT_TYPES_PART,
  contentTypesXml,
  PACKAGE_PART_CASES,
  SAFE_PART_CASES,
  UNSAFE_PART_CASES,
  WORKBOOK_RELS_PART,
  workbookRels,
} from '../tests/helpers/package-parts';
import { isXmlPart } from './content-scan';
import { UNSAFE_CONTENT_REASONS, ZIP_REJECT_REASONS } from './patch/reasons';
import {
  assertNoUnsafePackageParts,
  assertNoUnsafePartNames,
  UNSAFE_CONTENT_TYPE_MARKERS,
  UNSAFE_RELATIONSHIP_TYPE_ENDINGS,
} from './unsafe-parts';

/**
 * The type rule on a minimal package (content types and workbook rels) plus `entries`:
 * the name of every entry, the content of those the gate's stream keeps.
 */
function checkEntries(entries: Readonly<Record<string, string>>): void {
  const all: Record<string, string> = {
    [CONTENT_TYPES_PART]: contentTypesXml(),
    [WORKBOOK_RELS_PART]: workbookRels(),
    ...entries,
  };
  const contents = new Map<string, Uint8Array>();
  for (const [name, text] of Object.entries(all)) {
    if (isXmlPart(name)) contents.set(name, strToU8(text));
  }
  assertNoUnsafePackageParts(Object.keys(all), contents);
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
    const contents = new Map(Object.entries(entries).filter(([name]) => isXmlPart(name)));
    expect(() => assertNoUnsafePackageParts(Object.keys(entries), contents)).not.toThrow();
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
    ]);
    expect(UNSAFE_RELATIONSHIP_TYPE_ENDINGS).toEqual([
      'vbaproject',
      'externallink',
      'oleobject',
      'package',
      'control',
      'xlmacrosheet',
      'dialogsheet',
    ]);
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
