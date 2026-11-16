// Active content added to a real workbook fixture, for the route tests that pin the
// upload gate's UNSAFE_CONTENT refusal: at import, and when the export reads a stored
// file. Each builder takes the fixture's bytes (this helper reads no file of its own),
// unzips them, adds one thing and zips them again. `rezippedFixture` is the same path
// with nothing added, so a control case can prove that a refusal comes from the
// addition alone and not from the rebuild.

import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';

const CONTENT_TYPES_PART = '[Content_Types].xml';
const CONTENT_TYPES_END = '</Types>';

// A macro project part and the content type Excel finds it by. The part's bytes are
// never parsed: the start of an OLE compound file, not XML, so the refusal can only be
// the gate's active part rule.
const VBA_PROJECT_PART = 'xl/vbaProject.bin';
const VBA_PROJECT_OVERRIDE =
  '<Override ContentType="application/vnd.ms-office.vbaProject" PartName="/xl/vbaProject.bin"/>';
const VBA_PROJECT_BYTES = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// The first data cell of a sheet whose header is its first row, rewritten as a formula
// that fetches a URL. On the discount fixture it is the product id column, which the
// format reads and never writes.
const FORMULA_CELL = 'A2';
const FORMULA_CELL_RE = new RegExp(`<c r="${FORMULA_CELL}"[^>]*>.*?</c>`);
const UNSAFE_FORMULA_CELL = `<c r="${FORMULA_CELL}" t="str"><f>WEBSERVICE("http://example.com/")</f><v>0</v></c>`;

/** Unzips `source`, lets `edit` change its entries in place, and zips them again. */
function rebuildFixture(source: Buffer, edit: (entries: Unzipped) => void): Buffer {
  const entries = unzipSync(new Uint8Array(source));
  edit(entries);
  return Buffer.from(zipSync(entries));
}

/** The fixture unzipped and zipped again through the builders' own path, nothing added. */
export function rezippedFixture(source: Buffer): Buffer {
  return rebuildFixture(source, () => undefined);
}

/** The fixture plus a macro project part (`xl/vbaProject.bin`) and its content type Override. */
export function macroFixture(source: Buffer): Buffer {
  return rebuildFixture(source, (entries) => {
    const types = entries[CONTENT_TYPES_PART];
    if (types === undefined) throw new Error('the fixture has no content types part');
    const xml = strFromU8(types);
    const edited = xml.replace(CONTENT_TYPES_END, `${VBA_PROJECT_OVERRIDE}${CONTENT_TYPES_END}`);
    if (edited === xml) throw new Error('the content types part has no end tag');
    entries[CONTENT_TYPES_PART] = strToU8(edited);
    entries[VBA_PROJECT_PART] = new Uint8Array(VBA_PROJECT_BYTES);
  });
}

/** The fixture with the cell A2 of `sheetPart` holding a `WEBSERVICE` formula; every other entry keeps its bytes. */
export function unsafeFormulaFixture(source: Buffer, sheetPart: string): Buffer {
  return rebuildFixture(source, (entries) => {
    const part = entries[sheetPart];
    if (part === undefined) throw new Error(`the fixture has no part ${sheetPart}`);
    const xml = strFromU8(part);
    const edited = xml.replace(FORMULA_CELL_RE, UNSAFE_FORMULA_CELL);
    if (edited === xml) throw new Error(`the fixture has no cell ${FORMULA_CELL}`);
    entries[sheetPart] = strToU8(edited);
  });
}
