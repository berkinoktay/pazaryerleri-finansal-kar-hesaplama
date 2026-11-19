import { isRecord } from './wire-guards';

// The package census: the relationship types and content types an upload's package
// declares, recorded by the upload gate where it already reads them (the content types
// and relationships walk of unsafe-parts.ts, the root relationships rule of guards.ts),
// so the census adds no second parse. inspectWorkbookPackage (parse.ts) returns it; the
// stored-workbook audit counts it over the stored files, the data a future allow list of
// package part types is designed from.
//
// Type and ContentType are text the uploader chose, so the census keeps a value only
// when it has a fixed, URI-safe ASCII shape: a relationship Type that is an http(s) URI
// on one of the three OOXML schema hosts, a content type that is a plain `type/subtype`
// token, each at most MAX_CENSUS_VALUE_LENGTH characters long. Any other value only sets
// the `other` flag of its kind and is dropped: it is never returned, so it never reaches
// a log or a report. Past MAX_CENSUS_VALUES distinct kept values of one kind the census
// sets `overflow` and drops the rest.

/** The longest relationship type or content type the census keeps, in characters. */
export const MAX_CENSUS_VALUE_LENGTH = 160;

/** The most distinct values of one kind the census keeps per file; one more sets `overflow`. */
export const MAX_CENSUS_VALUES = 64;

/** A relationship Type the census keeps: an http(s) URI on an OOXML schema host, of URI-safe ASCII path segments. */
const CENSUS_RELATIONSHIP_TYPE =
  /^https?:\/\/(schemas\.openxmlformats\.org|schemas\.microsoft\.com|purl\.oclc\.org)(\/[A-Za-z0-9._~-]+)+$/;

/** A content type the census keeps: a plain `type/subtype` token, without parameters. */
const CENSUS_CONTENT_TYPE = /^[a-z0-9]+\/[A-Za-z0-9.+-]+$/;

/** What one package declares: the kept values (sorted, distinct) and the flags of what was dropped. */
export interface PackageCensus {
  readonly relationshipTypes: readonly string[];
  readonly contentTypes: readonly string[];
  /** A relationship Type the census does not keep was declared. */
  readonly otherRelationshipTypes: boolean;
  /** A content type the census does not keep was declared. */
  readonly otherContentTypes: boolean;
  /** More than MAX_CENSUS_VALUES distinct kept values of one kind were declared. */
  readonly overflow: boolean;
}

/** Records the values the gate reads; `result` returns the census of what it recorded. */
export interface PackageCensusCollector {
  /** A Relationship's Type, as the gate read it; null when it has none (counted as `other`). */
  addRelationshipType(type: string | null): void;
  /** A Default's or Override's ContentType, as the gate read it; null when it has none (counted as `other`). */
  addContentType(contentType: string | null): void;
  result(): PackageCensus;
}

function keepsRelationshipType(value: string): boolean {
  return value.length <= MAX_CENSUS_VALUE_LENGTH && CENSUS_RELATIONSHIP_TYPE.test(value);
}

function keepsContentType(value: string): boolean {
  return value.length <= MAX_CENSUS_VALUE_LENGTH && CENSUS_CONTENT_TYPE.test(value);
}

/**
 * Whether `value` is an array of at most MAX_CENSUS_VALUES strings, each one `keeps`
 * accepts, in strictly ascending order (so distinct). Indexed, not `every`, so a sparse
 * array (a hole reads as `undefined`) is refused.
 */
function isCensusValues(value: unknown, keeps: (item: string) => boolean): boolean {
  if (!Array.isArray(value) || value.length > MAX_CENSUS_VALUES) return false;
  let previous: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const item: unknown = value[i];
    if (typeof item !== 'string' || !keeps(item)) return false;
    if (previous !== null && !(previous < item)) return false;
    previous = item;
  }
  return true;
}

/**
 * Whether `value` is a census a collector can return: every kept value of the shape its
 * kind keeps, sorted and distinct, at most MAX_CENSUS_VALUES of each, and the three
 * flags booleans. The worker protocol checks the census answer with it, so a value the
 * census would have dropped never reaches the main thread.
 */
export function isPackageCensus(value: unknown): value is PackageCensus {
  return (
    isRecord(value) &&
    isCensusValues(value.relationshipTypes, keepsRelationshipType) &&
    isCensusValues(value.contentTypes, keepsContentType) &&
    typeof value.otherRelationshipTypes === 'boolean' &&
    typeof value.otherContentTypes === 'boolean' &&
    typeof value.overflow === 'boolean'
  );
}

/** A collector with nothing recorded (see the header for what it keeps and drops). */
export function createPackageCensusCollector(): PackageCensusCollector {
  const relationshipTypes = new Set<string>();
  const contentTypes = new Set<string>();
  let otherRelationshipTypes = false;
  let otherContentTypes = false;
  let overflow = false;

  /** Adds a kept value to `kept`, unless it is there already or `kept` is full (overflow). */
  function keep(kept: Set<string>, value: string): void {
    if (kept.has(value)) return;
    if (kept.size >= MAX_CENSUS_VALUES) {
      overflow = true;
      return;
    }
    kept.add(value);
  }

  return {
    addRelationshipType(type: string | null): void {
      if (type === null || !keepsRelationshipType(type)) {
        otherRelationshipTypes = true;
        return;
      }
      keep(relationshipTypes, type);
    },

    addContentType(contentType: string | null): void {
      if (contentType === null || !keepsContentType(contentType)) {
        otherContentTypes = true;
        return;
      }
      keep(contentTypes, contentType);
    },

    result(): PackageCensus {
      // The values are ASCII, so the default sort (UTF-16 code units) is a stable order.
      return {
        relationshipTypes: [...relationshipTypes].sort(),
        contentTypes: [...contentTypes].sort(),
        otherRelationshipTypes,
        otherContentTypes,
        overflow,
      };
    },
  };
}
