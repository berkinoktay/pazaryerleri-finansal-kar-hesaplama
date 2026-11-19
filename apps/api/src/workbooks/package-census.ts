// The package census tally of the stored-workbook audit (scripts/audit-stored-workbooks.ts,
// gate mode): over the stored files, how many FILES carry each relationship type and
// content type the engine's census keeps (inspectWorkbookPackage), how many carry a value
// the census drops or more values than it keeps, how many the gate refused, and how many
// the engine could not census at all (a busy queue or a worker limit). It is the
// data a future allow list of package part types is designed from.
//
// Pure, and it loads no package at runtime (a type import only): the audit script imports
// it before it makes DATABASE_URL read-only. Its input (PackageCensus) holds only sanitised
// schema URIs, content types and flags, so no part name, target, file name, record id or
// cell text can reach a printed line.

import type { PackageCensus } from '@pazarsync/spreadsheet';

/** The last path segments of the relationship types the real Trendyol files carry. */
export const BASELINE_RELATIONSHIP_TYPE_ENDINGS = [
  'officeDocument',
  'worksheet',
  'styles',
  'sharedStrings',
  'theme',
  'calcChain',
  'core-properties',
  'extended-properties',
] as const;

const BASELINE_ENDINGS: ReadonlySet<string> = new Set(BASELINE_RELATIONSHIP_TYPE_ENDINGS);

const VALUE_INDENT = '  ';
const OUTSIDE_BASELINE_SUFFIX = ' (outside the baseline)';
const RELATIONSHIP_TYPES_HEADING = 'relationship types:';
const CONTENT_TYPES_HEADING = 'content types:';
const OTHER_BUCKET_LABEL = 'other (dropped by the census, never printed)';
const OVERFLOW_LABEL = 'files with more distinct values of one kind than the census keeps';

/** The census of every stored file the audit read, counted per file. */
export interface CensusTally {
  filesCensused: number;
  filesRefused: number;
  /** Files the engine could not census: a busy queue or a worker memory or time limit. */
  filesNotCensused: number;
  /** Per relationship type, the number of files that carry it. */
  readonly relationshipTypes: Map<string, number>;
  /** Per content type, the number of files that carry it. */
  readonly contentTypes: Map<string, number>;
  filesWithOtherRelationshipTypes: number;
  filesWithOtherContentTypes: number;
  filesWithOverflow: number;
}

export function createCensusTally(): CensusTally {
  return {
    filesCensused: 0,
    filesRefused: 0,
    filesNotCensused: 0,
    relationshipTypes: new Map(),
    contentTypes: new Map(),
    filesWithOtherRelationshipTypes: 0,
    filesWithOtherContentTypes: 0,
    filesWithOverflow: 0,
  };
}

/** Adds one to the count of each distinct value of `values`: a file counts once per value. */
function countFile(counts: Map<string, number>, values: readonly string[]): void {
  for (const value of new Set(values)) counts.set(value, (counts.get(value) ?? 0) + 1);
}

/** Adds the census of one stored file. */
export function addCensus(tally: CensusTally, census: PackageCensus): void {
  tally.filesCensused += 1;
  countFile(tally.relationshipTypes, census.relationshipTypes);
  countFile(tally.contentTypes, census.contentTypes);
  if (census.otherRelationshipTypes) tally.filesWithOtherRelationshipTypes += 1;
  if (census.otherContentTypes) tally.filesWithOtherContentTypes += 1;
  if (census.overflow) tally.filesWithOverflow += 1;
}

/** Counts one stored file the gate refused, so it has no census. */
export function addRefused(tally: CensusTally): void {
  tally.filesRefused += 1;
}

/**
 * Counts one stored file the engine could not census (a busy queue or a worker limit), so
 * it is neither a census nor a gate refusal.
 */
export function addNotCensused(tally: CensusTally): void {
  tally.filesNotCensused += 1;
}

function lastSegment(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

function relationshipTypeSuffix(uri: string): string {
  return BASELINE_ENDINGS.has(lastSegment(uri)) ? '' : OUTSIDE_BASELINE_SUFFIX;
}

/** One line per value, sorted by UTF-16 code unit (the values are ASCII): `<value>: <files><suffix>`. */
function valueLines(
  counts: ReadonlyMap<string, number>,
  suffix: (value: string) => string,
): string[] {
  return [...counts.keys()]
    .sort()
    .map((value) => `${VALUE_INDENT}${value}: ${counts.get(value) ?? 0}${suffix(value)}`);
}

/** The line of a bucket, only when a file falls in it. */
function bucketLine(label: string, files: number): string[] {
  return files > 0 ? [`${label}: ${files}`] : [];
}

const NO_SUFFIX = (): string => '';

/**
 * The printable census: the denominator, then the relationship types (a type whose last
 * segment is not in BASELINE_RELATIONSHIP_TYPE_ENDINGS is marked) and the content types,
 * each value with the number of files that carry it, then each `other` bucket and the
 * overflow line only when a file falls in it. The order is stable: sorted values, fixed
 * sections.
 */
export function censusLines(tally: CensusTally): string[] {
  return [
    `files censused ${tally.filesCensused}, refused by the gate ${tally.filesRefused}, not censused (queue busy or a worker limit) ${tally.filesNotCensused}`,
    RELATIONSHIP_TYPES_HEADING,
    ...valueLines(tally.relationshipTypes, relationshipTypeSuffix),
    ...bucketLine(`${VALUE_INDENT}${OTHER_BUCKET_LABEL}`, tally.filesWithOtherRelationshipTypes),
    CONTENT_TYPES_HEADING,
    ...valueLines(tally.contentTypes, NO_SUFFIX),
    ...bucketLine(`${VALUE_INDENT}${OTHER_BUCKET_LABEL}`, tally.filesWithOtherContentTypes),
    // One flag per file covers both kinds, so its line stands outside the two sections.
    ...bucketLine(OVERFLOW_LABEL, tally.filesWithOverflow),
  ];
}
