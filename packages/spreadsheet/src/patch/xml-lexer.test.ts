import { describe, expect, it } from 'vitest';

import { expectWithinBudget, LINEAR_BUDGET_MS } from '../../tests/helpers/timing';
import {
  ATTRIBUTE_FIELDS,
  ATTRIBUTE_NAME_START,
  ATTRIBUTE_VALUE_END,
  ATTRIBUTE_VALUE_START,
  attributeField,
  bytesEqualAscii,
  createMarkup,
  localNameIs,
  localNameStart,
  nextMarkup,
  scanDeclaration,
  scanMarkup,
  valueAt,
  XmlLexError,
  type XmlMarkup,
} from './xml-lexer';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Built from code units so the source file stays ASCII.
const C1_CONTROL = String.fromCharCode(0x80);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const U_DIAERESIS = String.fromCharCode(0xfc);

const REPEATED_COMMENT_OPENS = 200_000;
const ATTRIBUTE_COUNT = 200_000;
const TAG_COUNT = 1_000_000;
const LINEAR_TEST_TIMEOUT_MS = 120_000;

interface Scanned {
  readonly bytes: Uint8Array;
  readonly markup: XmlMarkup;
}

function scanFirst(text: string, attributes?: number[]): Scanned {
  const bytes = encoder.encode(text);
  const markup = createMarkup();
  scanMarkup(bytes, 0, markup, attributes);
  return { bytes, markup };
}

function textOf(bytes: Uint8Array, start: number, end: number): string {
  return decoder.decode(bytes.subarray(start, end));
}

/** Attribute `index` of a filled attribute list, as name and value text. */
function attributeAt(
  bytes: Uint8Array,
  attributes: readonly number[],
  index: number,
): { name: string; value: string } {
  const base = index * ATTRIBUTE_FIELDS;
  const [nameStart = 0, nameEnd = 0, valueStart = 0, valueEnd = 0] = attributes.slice(
    base,
    base + ATTRIBUTE_FIELDS,
  );
  return {
    name: textOf(bytes, nameStart, nameEnd),
    value: textOf(bytes, valueStart, valueEnd),
  };
}

function lexErrorOf(run: () => void): XmlLexError {
  try {
    run();
  } catch (error) {
    if (error instanceof XmlLexError) return error;
    throw error;
  }
  throw new Error('Expected an XmlLexError');
}

describe('scanMarkup: offsets', () => {
  it('reads a start tag with a double- and a single-quoted attribute', () => {
    const attributes: number[] = [];
    const { markup } = scanFirst(`<c r="A1" s='3'>`, attributes);
    expect(markup).toEqual({
      kind: 'start',
      start: 0,
      end: 16,
      nameStart: 1,
      nameEnd: 2,
      attributeCount: 2,
    });
    expect(attributes).toEqual([3, 4, 6, 8, 10, 11, 13, 14]);
  });

  it('reads a prefixed empty tag and finds its local name', () => {
    const attributes: number[] = [];
    const { bytes, markup } = scanFirst('<x:row r="2"/>', attributes);
    expect(markup.kind).toBe('empty');
    expect(markup.end).toBe(bytes.length);
    expect(textOf(bytes, markup.nameStart, markup.nameEnd)).toBe('x:row');
    expect(localNameStart(bytes, markup)).toBe(3);
    expect(attributeAt(bytes, attributes, 0)).toEqual({ name: 'r', value: '2' });
  });

  it('reads an end tag with whitespace before its ">"', () => {
    const { bytes, markup } = scanFirst('</x:row >');
    expect(markup).toEqual({
      kind: 'end',
      start: 0,
      end: 9,
      nameStart: 2,
      nameEnd: 7,
      attributeCount: 0,
    });
    expect(localNameStart(bytes, markup)).toBe(4);
  });

  it('gives an unprefixed name its own start as the local name', () => {
    const { bytes, markup } = scanFirst('<row r="1">');
    expect(localNameStart(bytes, markup)).toBe(markup.nameStart);
  });

  it('accepts whitespace around "=" and before ">"', () => {
    const attributes: number[] = [];
    const { bytes, markup } = scanFirst('<row\n\tr = "1"\r\n>', attributes);
    expect(markup.kind).toBe('start');
    expect(markup.end).toBe(bytes.length);
    expect(markup.attributeCount).toBe(1);
    expect(attributes).toHaveLength(ATTRIBUTE_FIELDS);
    expect(attributeAt(bytes, attributes, 0)).toEqual({ name: 'r', value: '1' });
  });

  it('does not end a tag at a ">" inside a quoted value', () => {
    const attributes: number[] = [];
    const { bytes, markup } = scanFirst('<c x="a>b" r="A1">', attributes);
    expect(markup.kind).toBe('start');
    expect(markup.end).toBe(bytes.length);
    expect(attributeAt(bytes, attributes, 0)).toEqual({ name: 'x', value: 'a>b' });
    expect(attributeAt(bytes, attributes, 1)).toEqual({ name: 'r', value: 'A1' });
  });

  it('counts no attributes for a markup that is not a start or empty tag', () => {
    const attributes: number[] = [];
    scanFirst('<c r="A1" s="2">', attributes);
    for (const text of ['</c>', '<!-- x -->', '<![CDATA[x]]>', '<?p x?>']) {
      expect(scanFirst(text, attributes).markup.attributeCount).toBe(0);
    }
  });

  it('writes from the start of the list and never shrinks it', () => {
    const attributes: number[] = [];
    const markup = createMarkup();
    const wide = encoder.encode('<c r="A1" s="2" t="n">');
    scanMarkup(wide, 0, markup, attributes);
    expect(markup.attributeCount).toBe(3);
    const narrow = encoder.encode('<c r="B1"/>');
    scanMarkup(narrow, 0, markup, attributes);
    expect(markup.attributeCount).toBe(1);
    expect(attributes).toHaveLength(3 * ATTRIBUTE_FIELDS);
    expect(attributeAt(narrow, attributes, 0)).toEqual({ name: 'r', value: 'B1' });
    scanMarkup(narrow, 0, markup);
    expect(markup.attributeCount).toBe(1);
  });

  it('scans a markup at a non-zero offset', () => {
    const bytes = encoder.encode('ab<c r="A1"/>cd');
    const markup = createMarkup();
    const at = nextMarkup(bytes, 0);
    expect(at).toBe(2);
    scanMarkup(bytes, at, markup);
    expect(markup).toEqual({
      kind: 'empty',
      start: 2,
      end: 13,
      nameStart: 3,
      nameEnd: 4,
      attributeCount: 1,
    });
    expect(nextMarkup(bytes, markup.end)).toBe(-1);
  });
});

describe('scanMarkup: opaque markup', () => {
  it('ends a comment at its "-->" and never reads the markup inside it', () => {
    const { bytes, markup } = scanFirst('<!-- <row r="9"> -->x');
    expect(markup).toEqual({
      kind: 'opaque',
      start: 0,
      end: 20,
      nameStart: 0,
      nameEnd: 0,
      attributeCount: 0,
    });
    expect(nextMarkup(bytes, markup.end)).toBe(-1);
  });

  it('ends a CDATA section at its first "]]>"', () => {
    const text = '<![CDATA[ ]] <c/> ]]>';
    const { markup } = scanFirst(text);
    expect(markup.kind).toBe('opaque');
    expect(markup.end).toBe(text.indexOf(']]>') + ']]>'.length);
    expect(markup.nameStart).toBe(0);
    expect(markup.nameEnd).toBe(0);
  });

  it('ends a processing instruction at its first "?>" and reads its target', () => {
    const text = '<?p <c r="B1"/> ?>';
    const { bytes, markup } = scanFirst(text);
    expect(markup.kind).toBe('opaque');
    expect(markup.end).toBe(text.indexOf('?>') + '?>'.length);
    expect(textOf(bytes, markup.nameStart, markup.nameEnd)).toBe('p');
  });

  it('reads a processing instruction whose target is followed by "?>" or whitespace', () => {
    const closed = scanFirst('<?p?>');
    expect(closed.markup.kind).toBe('opaque');
    expect(closed.markup.end).toBe(5);
    expect(textOf(closed.bytes, closed.markup.nameStart, closed.markup.nameEnd)).toBe('p');
    const spaced = scanFirst('<?p\t?>');
    expect(spaced.markup.end).toBe(spaced.bytes.length);
    expect(textOf(spaced.bytes, spaced.markup.nameStart, spaced.markup.nameEnd)).toBe('p');
  });

  it('reads a comment whose body starts with "-" as one comment', () => {
    const { bytes, markup } = scanFirst('<!---><row r="1"/>-->');
    expect(markup.kind).toBe('opaque');
    expect(markup.end).toBe(bytes.length);
  });
});

describe('scanDeclaration', () => {
  it('reads the three pseudo-attributes of an XML declaration', () => {
    const { bytes, markup } = scanFirst(`<?xml version="1.0" encoding='UTF-8' standalone="yes"?>`);
    const attributes: number[] = [];
    scanDeclaration(bytes, markup, attributes);
    expect(markup.attributeCount).toBe(3);
    expect(attributes).toHaveLength(3 * ATTRIBUTE_FIELDS);
    expect(attributeAt(bytes, attributes, 0)).toEqual({ name: 'version', value: '1.0' });
    expect(attributeAt(bytes, attributes, 1)).toEqual({ name: 'encoding', value: 'UTF-8' });
    expect(attributeAt(bytes, attributes, 2)).toEqual({ name: 'standalone', value: 'yes' });
  });

  it('rejects an unquoted pseudo-attribute value', () => {
    const { bytes, markup } = scanFirst('<?xml version=1.0?>');
    expect(() => scanDeclaration(bytes, markup, [])).toThrow(XmlLexError);
  });
});

describe('scanMarkup: rejected markup', () => {
  // Each input is one xmldom accepts leniently, or one that is not well-formed.
  // Control and non-ASCII inputs are escapes or code-unit constants (file stays ASCII).
  it.each<[string, string]>([
    ['an unquoted value', '<c r=A1>'],
    ['no whitespace between attributes', '<c r="A1"s="1">'],
    ['whitespace between "/" and ">"', '<row r="1" / >'],
    ['a "/" before an attribute', '<c r="A1" / s="2">'],
    ['U+0080 as tag whitespace', `<row${C1_CONTROL}r="1">`],
    ['a form feed as tag whitespace', '<c\fr="A1">'],
    ['U+0001 as tag whitespace', '<c\u0001r="A1"/>'],
    ['NUL as tag whitespace', '<c\u0000r="A1">'],
    ['a vertical tab as tag whitespace', '<c\u000Br="A1">'],
    ['U+2028 as tag whitespace', `<c${LINE_SEPARATOR}r="A1">`],
    ['a valueless attribute', '<c r="A1" x>'],
    ['a "<" inside a quoted value', '<c x="<">'],
    ['a DOCTYPE', '<!DOCTYPE a>'],
    ['an ENTITY', '<!ENTITY a "b">'],
    ['an empty tag name', '<>'],
    ['whitespace before the tag name', '< c>'],
    ['an attribute on an end tag', '</c x="1">'],
    ['a name starting with a digit', '<1c>'],
    ['a name ending with a colon', '<c:>'],
    ['a name starting with a colon', '<:c>'],
    ['a name with two colons', '<a:b:c>'],
    ['a non-ASCII element name', `<${U_DIAERESIS} r="1">`],
    ['a non-ASCII prefix', `<${U_DIAERESIS}:row r="1">`],
    ['a non-ASCII attribute name', `<c r="A1" ${U_DIAERESIS}="1">`],
    ['a tag cut off by the end of input', '<c r="A1"'],
    ['an unclosed comment', '<!-- x'],
    ['an unclosed CDATA section', '<![CDATA[x'],
    ['an unclosed processing instruction', '<?p x'],
    ['"--" inside a comment', '<!-- a -- b -->'],
    ['a processing instruction without a target', '<?>'],
    // Stricter than the plan's wording, as XML and xmldom require: S or '?>' after the target.
    ['a "?" right after a processing instruction target', '<?p?x ?>'],
    ['a "<" right after a processing instruction target', '<?p<c/>?>'],
  ])('rejects %s', (_label, input) => {
    expect(() => scanFirst(input)).toThrow(XmlLexError);
  });
});

describe('bytesEqualAscii', () => {
  it('compares a byte range with an ASCII string', () => {
    const bytes = encoder.encode('<row r="1">');
    expect(bytesEqualAscii(bytes, 1, 4, 'row')).toBe(true);
    expect(bytesEqualAscii(bytes, 1, 4, 'rows')).toBe(false);
    expect(bytesEqualAscii(bytes, 1, 3, 'row')).toBe(false);
    expect(bytesEqualAscii(bytes, 9, 12, 'x">')).toBe(false);
  });
});

describe('valueAt', () => {
  it('reads an entry and throws past either end of the list', () => {
    const list = [7, 8, 9];
    expect(valueAt(list, 0)).toBe(7);
    expect(valueAt(list, 2)).toBe(9);
    expect(() => valueAt(list, 3)).toThrow('Index 3 is out of range');
    expect(() => valueAt(list, -1)).toThrow('Index -1 is out of range');
  });
});

describe('attributeField', () => {
  it('reads one field of one attribute and throws past the filled list', () => {
    const attributes: number[] = [];
    scanFirst(`<c r="A1" s='3'>`, attributes);
    expect(attributeField(attributes, 0, ATTRIBUTE_VALUE_START)).toBe(6);
    expect(attributeField(attributes, 1, ATTRIBUTE_NAME_START)).toBe(10);
    expect(attributeField(attributes, 1, ATTRIBUTE_VALUE_END)).toBe(14);
    expect(() => attributeField(attributes, 2, ATTRIBUTE_NAME_START)).toThrow(
      'Index 8 is out of range',
    );
  });
});

describe('localNameIs', () => {
  it('compares the local name after any prefix, exactly', () => {
    const prefixed = scanFirst('<x:row r="2"/>');
    expect(localNameIs(prefixed.bytes, prefixed.markup, 'row')).toBe(true);
    expect(localNameIs(prefixed.bytes, prefixed.markup, 'x:row')).toBe(false);
    expect(localNameIs(prefixed.bytes, prefixed.markup, 'ro')).toBe(false);

    const plain = scanFirst('<row r="1">');
    expect(localNameIs(plain.bytes, plain.markup, 'row')).toBe(true);
    expect(localNameIs(plain.bytes, plain.markup, 'Row')).toBe(false);
  });
});

describe('scanMarkup: linear time', { timeout: LINEAR_TEST_TIMEOUT_MS }, () => {
  it('throws on a run of comment openers after one search', () => {
    const bytes = encoder.encode('<!--'.repeat(REPEATED_COMMENT_OPENS));
    const started = performance.now();
    const error = lexErrorOf(() => scanMarkup(bytes, 0, createMarkup()));
    expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);
    // The first "--" after the opener sits at offset 6 and is not followed by ">".
    expect(error.offset).toBe(6);
  });

  it('scans one tag with 200 000 distinct attributes', () => {
    const names = Array.from({ length: ATTRIBUTE_COUNT }, (_, index) => `a${index}="1"`);
    const bytes = encoder.encode(`<c ${names.join(' ')}/>`);
    const markup = createMarkup();
    const attributes: number[] = [];
    const started = performance.now();
    scanMarkup(bytes, 0, markup, attributes);
    expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);
    expect(markup.kind).toBe('empty');
    expect(markup.end).toBe(bytes.length);
    expect(attributes).toHaveLength(ATTRIBUTE_COUNT * ATTRIBUTE_FIELDS);
  });

  it('scans 1 000 000 tags in one loop', () => {
    const bytes = encoder.encode('<c r="A1"/>'.repeat(TAG_COUNT));
    const markup = createMarkup();
    const attributes: number[] = [];
    let count = 0;
    const started = performance.now();
    for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, markup.end)) {
      scanMarkup(bytes, at, markup, attributes);
      count += 1;
    }
    expectWithinBudget(performance.now() - started, LINEAR_BUDGET_MS);
    expect(count).toBe(TAG_COUNT);
    expect(markup.end).toBe(bytes.length);
  });
});
