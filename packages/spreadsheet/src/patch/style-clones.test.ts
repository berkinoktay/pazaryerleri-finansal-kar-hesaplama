import { describe, expect, it } from 'vitest';

import { MAIN_NAMESPACE, stylesXml } from '../../tests/helpers/patch-helpers';
import { PATCH_GROWTH_FLOOR_BYTES } from './limits';
import { patchedPartCap } from './patch-worksheet';
import { StyleClones } from './style-clones';

const STYLES_ENTRY = 'xl/styles.xml';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const DEFAULT_ROOT = `xmlns="${MAIN_NAMESPACE}"`;
const BYTE_ORDER_MARK_CODE = 0xfeff;
// cellXfs: 0 General, 1 a date (numFmt 14).
const TABLE: readonly boolean[] = [false, true];
const CELL_XFS = '<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>';
const GENERAL_CLONE = '<xf numFmtId="0" applyNumberFormat="1"/>';
// A byte that never starts or continues a UTF-8 sequence, and the ASCII marker it replaces.
const INVALID_UTF8_BYTE = 0xff;
const MARKER = '~';
const BYTE_ORDER_MARK = String.fromCharCode(BYTE_ORDER_MARK_CODE);
// A styles part past the growth cap's floor: every entry a date, each cloned.
const DATE_XF = '<xf numFmtId="14" applyNumberFormat="1"/>';
const LARGE_XF_COUNT = 2_000;

const encoder = new TextEncoder();
// Keeps a leading byte order mark, so a test can see it was kept.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** A StyleClones over `styles` with the date table `xfIsDate`, one output begun. */
function clonesOf(styles: string | Uint8Array, xfIsDate: readonly boolean[]): StyleClones {
  const bytes = typeof styles === 'string' ? encoder.encode(styles) : styles;
  const clones = new StyleClones(bytes, STYLES_ENTRY, xfIsDate);
  clones.begin();
  return clones;
}

/** The built styles part as text, or null. */
function builtText(clones: StyleClones): string | null {
  const built = clones.build();
  return built === null ? null : decoder.decode(built);
}

/** `xml` with every MARKER byte replaced by a byte that is not UTF-8. */
function notUtf8(xml: string): Uint8Array {
  const bytes = encoder.encode(xml);
  const marker = MARKER.charCodeAt(0);
  return bytes.map((byte) => (byte === marker ? INVALID_UTF8_BYTE : byte));
}

describe('StyleClones: the clone', () => {
  it('copies the xf byte for byte, children and other attributes included', () => {
    const date =
      '<xf numFmtId="14" fontId="3" fillId="0" applyNumberFormat="0" applyFont="1" xfId="0">' +
      '<alignment horizontal="center" vertical="top"/><protection locked="0"/></xf>';
    const clone =
      '<xf numFmtId="0" fontId="3" fillId="0" applyNumberFormat="1" applyFont="1" xfId="0">' +
      '<alignment horizontal="center" vertical="top"/><protection locked="0"/></xf>';
    const xml = stylesXml(
      '<fonts count="1"><font/></fonts>' +
        `<cellXfs count="2"><xf numFmtId="0"/>${date}</cellXfs>` +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    );
    const clones = clonesOf(xml, TABLE);

    expect(clones.generalStyleOf(1)).toBe(2);
    expect(clones.requested).toBe(1);
    expect(builtText(clones)).toBe(
      xml.replace('count="2"', 'count="3"').replace('</cellXfs>', `${clone}</cellXfs>`),
    );
  });

  it.each([
    [
      'inserts applyNumberFormat right after numFmtId',
      '<xf fontId="1" numFmtId="14" borderId="2"/>',
      '<xf fontId="1" numFmtId="0" applyNumberFormat="1" borderId="2"/>',
    ],
    [
      'keeps single quotes and the spaces around "="',
      "<xf numFmtId = '22'/>",
      `<xf numFmtId = '0' applyNumberFormat="1"/>`,
    ],
    [
      'sets an applyNumberFormat that comes before numFmtId',
      "<xf applyNumberFormat='0' numFmtId='14'/>",
      "<xf applyNumberFormat='1' numFmtId='0'/>",
    ],
    [
      'replaces any applyNumberFormat value, in an xf with an end tag',
      '<xf numFmtId="14" applyNumberFormat="true"></xf>',
      '<xf numFmtId="0" applyNumberFormat="1"></xf>',
    ],
  ])('%s; an absent count stays absent', (_, source, clone) => {
    const xml = stylesXml(`<cellXfs><xf numFmtId="0"/>${source}</cellXfs>`);
    const clones = clonesOf(xml, TABLE);

    expect(clones.generalStyleOf(1)).toBe(2);
    expect(builtText(clones)).toBe(
      stylesXml(`<cellXfs><xf numFmtId="0"/>${source}${clone}</cellXfs>`),
    );
  });

  it('clones in a prefixed styles part', () => {
    const xml =
      `${XML_DECLARATION}<x:styleSheet xmlns:x="${MAIN_NAMESPACE}"><x:cellXfs count="2">` +
      '<x:xf numFmtId="0"/><x:xf numFmtId="14"/></x:cellXfs></x:styleSheet>';
    const clones = clonesOf(xml, TABLE);

    expect(clones.generalStyleOf(1)).toBe(2);
    expect(builtText(clones)).toBe(
      xml
        .replace('count="2"', 'count="3"')
        .replace('</x:cellXfs>', '<x:xf numFmtId="0" applyNumberFormat="1"/></x:cellXfs>'),
    );
  });

  it('keeps a leading byte order mark', () => {
    const xml = `${BYTE_ORDER_MARK}${stylesXml(CELL_XFS)}`;
    const clones = clonesOf(xml, TABLE);

    expect(clones.generalStyleOf(1)).toBe(2);
    expect(builtText(clones)).toBe(
      xml.replace('count="2"', 'count="3"').replace('</cellXfs>', `${GENERAL_CLONE}</cellXfs>`),
    );
  });
});

describe('StyleClones: numbering and memo', () => {
  const xml = stylesXml(
    '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="22" fontId="1"/></cellXfs>',
  );
  const table: readonly boolean[] = [false, true, true];
  const cloneOfOne = GENERAL_CLONE;
  const cloneOfTwo = '<xf numFmtId="0" applyNumberFormat="1" fontId="1"/>';

  it('gives one clone per source, in the order of first use', () => {
    const clones = clonesOf(xml, table);

    expect(clones.generalStyleOf(2)).toBe(3);
    expect(clones.generalStyleOf(1)).toBe(4);
    expect(clones.generalStyleOf(2)).toBe(3);
    expect(clones.requested).toBe(2);
    expect(builtText(clones)).toBe(
      xml
        .replace('count="3"', 'count="5"')
        .replace('</cellXfs>', `${cloneOfTwo}${cloneOfOne}</cellXfs>`),
    );
  });

  it('answers null for a style that formats no date or is not in the table', () => {
    const clones = clonesOf(xml, table);

    expect(clones.generalStyleOf(0)).toBeNull();
    expect(clones.generalStyleOf(3)).toBeNull();
    expect(clones.generalStyleOf(-1)).toBeNull();
    expect(clones.requested).toBe(0);
    expect(clones.build()).toBeNull();
  });

  it('numbers each output from the end of the table again', () => {
    const clones = clonesOf(xml, table);
    expect(clones.generalStyleOf(2)).toBe(3);
    expect(builtText(clones)).toBe(
      xml.replace('count="3"', 'count="4"').replace('</cellXfs>', `${cloneOfTwo}</cellXfs>`),
    );

    clones.begin();

    expect(clones.requested).toBe(0);
    expect(clones.generalStyleOf(1)).toBe(3);
    expect(builtText(clones)).toBe(
      xml.replace('count="3"', 'count="4"').replace('</cellXfs>', `${cloneOfOne}</cellXfs>`),
    );
  });

  it('shares one built part between outputs that need the same clones in the same order', () => {
    const clones = clonesOf(xml, table);
    clones.generalStyleOf(1);
    clones.generalStyleOf(2);
    const first = clones.build();

    clones.begin();
    clones.generalStyleOf(1);
    clones.generalStyleOf(2);
    const second = clones.build();

    clones.begin();
    clones.generalStyleOf(2);
    clones.generalStyleOf(1);
    const reordered = clones.build();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(reordered).not.toBeNull();
    expect(reordered).not.toBe(first);
  });

  it('answers null once disabled, in this output and the next', () => {
    const clones = clonesOf(xml, table);
    expect(clones.generalStyleOf(1)).toBe(3);

    clones.disable();

    expect(clones.requested).toBe(0);
    expect(clones.generalStyleOf(1)).toBeNull();
    expect(clones.build()).toBeNull();
    clones.begin();
    expect(clones.generalStyleOf(2)).toBeNull();
  });

  it('answers null without a styles part', () => {
    const clones = new StyleClones(null, STYLES_ENTRY, TABLE);
    clones.begin();

    expect(clones.generalStyleOf(1)).toBeNull();
    expect(clones.build()).toBeNull();
  });
});

describe('StyleClones: refusals', () => {
  const REFUSED: readonly (readonly [
    label: string,
    styles: string | Uint8Array,
    xfIsDate: readonly boolean[],
  ])[] = [
    ['bytes that are not UTF-8', notUtf8(stylesXml(`${CELL_XFS}<!--${MARKER}-->`)), TABLE],
    [
      'a declaration of another encoding',
      `<?xml version="1.0" encoding="UTF-16"?><styleSheet ${DEFAULT_ROOT}>${CELL_XFS}</styleSheet>`,
      TABLE,
    ],
    ['a declaration that is not the first markup', `<!-- c -->${stylesXml(CELL_XFS)}`, TABLE],
    [
      'an xml target in another case',
      `<?XML version="1.0"?><styleSheet ${DEFAULT_ROOT}>${CELL_XFS}</styleSheet>`,
      TABLE,
    ],
    [
      'malformed markup',
      stylesXml('<cellXfs count=2><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>'),
      TABLE,
    ],
    ['a document type declaration', `<!DOCTYPE styleSheet>${stylesXml(CELL_XFS)}`, TABLE],
    ['no root element', XML_DECLARATION, TABLE],
    ['a second root element', `${stylesXml(CELL_XFS)}<styleSheet/>`, TABLE],
    ['an end tag outside the root', `${stylesXml(CELL_XFS)}</styleSheet>`, TABLE],
    [
      'a root that never closes',
      `${XML_DECLARATION}<styleSheet ${DEFAULT_ROOT}>${CELL_XFS}`,
      TABLE,
    ],
    ['no cellXfs', stylesXml('<fonts count="0"/>'), TABLE],
    ['a self-closing cellXfs', stylesXml('<cellXfs count="0"/>'), TABLE],
    ['a second cellXfs', stylesXml(`${CELL_XFS}<cellXfs count="0"></cellXfs>`), TABLE],
    [
      'a child of cellXfs that is not an xf',
      stylesXml('<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/><extLst/></cellXfs>'),
      TABLE,
    ],
    [
      'an xf under another prefix than its cellXfs',
      stylesXml(
        `<cellXfs count="2"><xf numFmtId="0"/><x:xf xmlns:x="${MAIN_NAMESPACE}" numFmtId="14"/></cellXfs>`,
      ),
      TABLE,
    ],
    [
      'an xf count other than the table',
      stylesXml(
        '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="0"/></cellXfs>',
      ),
      TABLE,
    ],
    [
      'a source xf without numFmtId',
      stylesXml('<cellXfs count="2"><xf numFmtId="0"/><xf applyNumberFormat="1"/></cellXfs>'),
      TABLE,
    ],
    [
      'a source xf with a prefixed numFmtId only',
      stylesXml(
        '<cellXfs count="2"><xf numFmtId="0"/><xf xmlns:x="urn:x" x:numFmtId="14"/></cellXfs>',
      ),
      TABLE,
    ],
    [
      'a source xf with two numFmtId',
      stylesXml('<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" numFmtId="14"/></cellXfs>'),
      TABLE,
    ],
    [
      'a source xf with two applyNumberFormat',
      stylesXml(
        '<cellXfs count="2"><xf numFmtId="0"/>' +
          '<xf numFmtId="14" applyNumberFormat="1" applyNumberFormat="1"/></cellXfs>',
      ),
      TABLE,
    ],
  ];

  it.each(REFUSED)('answers null, and never throws, for %s', (_, styles, xfIsDate) => {
    const clones = clonesOf(styles, xfIsDate);

    expect(clones.generalStyleOf(1)).toBeNull();
    expect(clones.requested).toBe(0);
    expect(clones.build()).toBeNull();
  });

  it('refuses a build whose clones a custom number format reads as dates', () => {
    const xml = stylesXml(
      '<numFmts count="1"><numFmt numFmtId="0" formatCode="dd/mm/yyyy"/></numFmts>' + CELL_XFS,
    );
    const clones = clonesOf(xml, [true, true]);

    expect(clones.generalStyleOf(1)).toBe(2);
    expect(clones.build()).toBeNull();
  });

  it('refuses a build past the growth cap; a smaller one fits', () => {
    const bytes = encoder.encode(
      stylesXml(`<cellXfs count="${LARGE_XF_COUNT}">${DATE_XF.repeat(LARGE_XF_COUNT)}</cellXfs>`),
    );
    const table = Array.from({ length: LARGE_XF_COUNT }, () => true);
    expect(bytes.length).toBeGreaterThan(PATCH_GROWTH_FLOOR_BYTES);
    expect(bytes.length + LARGE_XF_COUNT * GENERAL_CLONE.length).toBeGreaterThan(
      patchedPartCap(bytes.length),
    );

    const every = clonesOf(bytes, table);
    for (let style = 0; style < LARGE_XF_COUNT; style += 1) {
      expect(every.generalStyleOf(style)).toBe(LARGE_XF_COUNT + style);
    }
    const one = clonesOf(bytes, table);
    one.generalStyleOf(0);

    expect(every.build()).toBeNull();
    expect(one.build()).not.toBeNull();
  });
});
