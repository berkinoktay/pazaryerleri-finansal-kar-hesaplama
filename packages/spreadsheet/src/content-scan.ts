import { strFromU8, type Unzipped } from 'fflate';
import { SpreadsheetFileError } from './errors';

// Zip entries whose content the gate keeps and the grid reader may parse as XML:
// exactly the names ending in `.xml` or `.xml.rels` (the rule read-excel-file's
// filterZipArchiveEntry used, kept so the same parts are read).
const XML_PART_SUFFIXES: readonly string[] = ['.xml', '.xml.rels'];

// A DOCTYPE or ENTITY declaration can define entities that expand exponentially
// (billion laughs) or resolve external resources (XXE). A genuine xlsx part never
// carries a DTD.
const DTD_DECLARATION = /<!(?:DOCTYPE|ENTITY)/i;

// An `&` that does not start one of the five predefined references or a numeric
// character reference. Linear: the lookahead only runs at `&` positions and its digit
// runs stop at the next non-digit, so no `[\s\S]*?` span is ever re-scanned.
// A bare `&` inside a CDATA section is rejected too, on purpose: Excel never writes
// CDATA, so this only fails closed on hand-made files.
const UNKNOWN_ENTITY_REFERENCE = /&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[0-9a-fA-F]+;)/;

export function isXmlPart(name: string): boolean {
  return XML_PART_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * Rejects one XML part, whatever its name, that declares a DOCTYPE or ENTITY (any
 * case), or references an entity other than the five predefined ones and numeric
 * character references. Throws SpreadsheetFileError('UNSAFE_CONTENT') naming `name`.
 */
export function assertSafeXmlPart(name: string, bytes: Uint8Array): void {
  const xml = strFromU8(bytes);

  if (DTD_DECLARATION.test(xml)) {
    throw new SpreadsheetFileError('UNSAFE_CONTENT', 'Workbook part declares a DOCTYPE or ENTITY', {
      entry: name,
    });
  }
  if (UNKNOWN_ENTITY_REFERENCE.test(xml)) {
    throw new SpreadsheetFileError('UNSAFE_CONTENT', 'Workbook part references an unknown entity', {
      entry: name,
    });
  }
}

/**
 * Rejects an unzipped xlsx whose XML parts (isXmlPart) fail assertSafeXmlPart. Throws
 * SpreadsheetFileError('UNSAFE_CONTENT') naming the offending entry.
 */
export function assertSafeXmlContent(entries: Unzipped): void {
  for (const [name, bytes] of Object.entries(entries)) {
    if (!isXmlPart(name)) continue;
    assertSafeXmlPart(name, bytes);
  }
}
