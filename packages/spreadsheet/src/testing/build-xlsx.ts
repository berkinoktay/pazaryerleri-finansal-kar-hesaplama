import { zipSync, strToU8 } from 'fflate';

import { columnLetters } from '../sheet-meta';

// Test-only builder for hand-shaped .xlsx packages. Engine tests use it to craft
// the exact XML a hostile or unusual workbook carries (namespace prefixes,
// relocated worksheet parts, bogus <dimension> refs) without a binary fixture.
// Exposed to other workspaces through the package's "./testing" export.

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PACKAGE_RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OFFICE_DOCUMENT_REL_TYPE = `${OFFICE_RELATIONSHIPS_NS}/officeDocument`;
const WORKSHEET_REL_TYPE = `${OFFICE_RELATIONSHIPS_NS}/worksheet`;
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const WORKSHEET_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

export interface XlsxFixtureSheet {
  readonly name: string;
  readonly xml: string;
  /** Zip entry name of the worksheet part; defaults to `xl/worksheets/sheet{n}.xml`. */
  readonly partPath?: string;
  /** Target in `xl/_rels/workbook.xml.rels`; defaults to `worksheets/sheet{n}.xml`. */
  readonly relTarget?: string;
}

type FixtureCell = string | number | null;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cellXml(p: string, ref: string, value: FixtureCell): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    return `<${p}c r="${ref}"><${p}v>${String(value)}</${p}v></${p}c>`;
  }
  return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${escapeXml(value)}</${p}t></${p}is></${p}c>`;
}

/**
 * Renders a worksheet part. Strings become inline-string cells, numbers become
 * `<v>` cells, nulls are skipped; every row and cell carries its `r` reference.
 * `prefix: 'x'` binds the SpreadsheetML namespace to `x:` and prefixes every
 * element; `dimension` emits `<dimension ref>` before `<sheetData>`.
 */
export function worksheetXml(
  rows: ReadonlyArray<ReadonlyArray<FixtureCell>>,
  opts: { readonly prefix?: string; readonly dimension?: string } = {},
): string {
  const prefix = opts.prefix ?? '';
  const p = prefix === '' ? '' : `${prefix}:`;
  const nsAttr =
    prefix === '' ? `xmlns="${SPREADSHEET_NS}"` : `xmlns:${prefix}="${SPREADSHEET_NS}"`;
  const dimension =
    opts.dimension === undefined ? '' : `<${p}dimension ref="${escapeXml(opts.dimension)}"/>`;

  const body = rows
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cellsXml = cells
        .map((value, colIndex) => cellXml(p, `${columnLetters(colIndex + 1)}${rowNumber}`, value))
        .join('');
      return `<${p}row r="${rowNumber}">${cellsXml}</${p}row>`;
    })
    .join('');

  return (
    `${XML_DECLARATION}<${p}worksheet ${nsAttr}>${dimension}` +
    `<${p}sheetData>${body}</${p}sheetData></${p}worksheet>`
  );
}

/**
 * Zips a minimal workbook: `[Content_Types].xml` (one Override per sheet part),
 * `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels` and each sheet.
 * `extraEntries` are added last and may replace any generated part.
 */
export function buildXlsxFixture(
  sheets: readonly XlsxFixtureSheet[],
  extraEntries: Readonly<Record<string, string>> = {},
): Buffer {
  const resolved = sheets.map((sheet, index) => {
    const n = index + 1;
    return {
      n,
      name: sheet.name,
      xml: sheet.xml,
      partPath: sheet.partPath ?? `xl/worksheets/sheet${n}.xml`,
      relTarget: sheet.relTarget ?? `worksheets/sheet${n}.xml`,
    };
  });

  const overrides = resolved
    .map(
      (s) =>
        `<Override PartName="/${escapeXml(s.partPath)}" ContentType="${WORKSHEET_CONTENT_TYPE}"/>`,
    )
    .join('');
  const contentTypes =
    `${XML_DECLARATION}<Types xmlns="${CONTENT_TYPES_NS}">` +
    `<Default Extension="rels" ContentType="${RELS_CONTENT_TYPE}"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="${WORKBOOK_CONTENT_TYPE}"/>` +
    `${overrides}</Types>`;

  const rootRels =
    `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL_TYPE}" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const sheetEntries = resolved
    .map((s) => `<sheet name="${escapeXml(s.name)}" sheetId="${s.n}" r:id="rId${s.n}"/>`)
    .join('');
  const workbook =
    `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}">` +
    `<sheets>${sheetEntries}</sheets></workbook>`;

  const sheetRels = resolved
    .map(
      (s) =>
        `<Relationship Id="rId${s.n}" Type="${WORKSHEET_REL_TYPE}" Target="${escapeXml(s.relTarget)}"/>`,
    )
    .join('');
  const workbookRels =
    `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NS}">` +
    `${sheetRels}</Relationships>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
  };
  for (const s of resolved) files[s.partPath] = strToU8(s.xml);
  for (const [path, text] of Object.entries(extraEntries)) files[path] = strToU8(text);

  return Buffer.from(zipSync(files));
}
