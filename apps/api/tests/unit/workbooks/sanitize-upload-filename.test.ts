import { describe, expect, it } from 'vitest';

import { cleanDisplayName, NameSchema } from '@/workbooks/form';
import { contentDisposition, sanitizeUploadFilename } from '@/workbooks/sanitize-upload-filename';

import { webClientFilename } from '../../helpers/web-client-filename';

// Every non-ASCII character is built from its code point, so this file stays ASCII and
// holds no invisible bidi or control character.
const DOTTED_CAPITAL_I = String.fromCodePoint(0x0130);
const S_CEDILLA_CAPITAL = String.fromCodePoint(0x015e);
const COMBINING_DOT_ABOVE = String.fromCodePoint(0x0307);
const COMBINING_CEDILLA = String.fromCodePoint(0x0327);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const BELL = String.fromCodePoint(0x0007);
// A format (Cf) character: it blocks canonical composition until it is dropped.
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
// One astral character: a surrogate pair in UTF-16.
const ASTRAL = String.fromCodePoint(0x1f600);

// 'Indirim Subat.XLSX' with its Turkish letters, precomposed (NFC) and decomposed (NFD).
const TURKISH_NAME_NFC = `${DOTTED_CAPITAL_I}ndirim ${S_CEDILLA_CAPITAL}ubat.XLSX`;
const TURKISH_NAME_NFD = `I${COMBINING_DOT_ABOVE}ndirim S${COMBINING_CEDILLA}ubat.XLSX`;

// An upload name that sanitizes to itself but carries header parameter syntax: copied
// as it is into the quoted fallback, its `filename*=` is the first one the web client
// finds, and the browser saves `setup.exe`.
const SMUGGLED_NAME = "rapor;filename*=UTF-8''setup.exe;.xlsx";
// The whole header: the quoted ASCII fallback, then the RFC 8187 name.
const DISPOSITION_RE = /^attachment; filename="([^"]*)"; filename\*=UTF-8''([^;]+)$/;

function codePoints(text: string): number {
  return Array.from(text).length;
}

/** No lone surrogate (what String.prototype.isWellFormed checks; not in the ES2022 lib). */
function isWellFormedText(text: string): boolean {
  return !/\p{Surrogate}/u.test(text);
}

describe('sanitizeUploadFilename', () => {
  it('keeps a plain name unchanged', () => {
    expect(sanitizeUploadFilename('trendyol_indirimler.xlsx')).toBe('trendyol_indirimler.xlsx');
  });

  it('keeps Turkish letters and the extension as written, in NFC', () => {
    expect(sanitizeUploadFilename(TURKISH_NAME_NFC)).toBe(TURKISH_NAME_NFC);
    expect(sanitizeUploadFilename(TURKISH_NAME_NFD)).toBe(TURKISH_NAME_NFC);
  });

  it('drops a bidi override and a control character', () => {
    expect(sanitizeUploadFilename(`rap${RIGHT_TO_LEFT_OVERRIDE}or${BELL}.xlsx`)).toBe('rapor.xlsx');
  });

  it('normalizes to NFC after dropping a format character between a letter and its combining mark', () => {
    const result = sanitizeUploadFilename(`I${ZERO_WIDTH_SPACE}${COMBINING_DOT_ABOVE}ndirim.xlsx`);
    expect(result).toBe(`${DOTTED_CAPITAL_I}ndirim.xlsx`);
    if (result === null) return;
    expect(result).toBe(result.normalize('NFC'));
  });

  it('drops slashes and backslashes', () => {
    expect(sanitizeUploadFilename('a/b\\c.xlsx')).toBe('abc.xlsx');
  });

  it('cuts a long stem so that the name is 120 characters ending in .xlsx', () => {
    const result = sanitizeUploadFilename(`${'a'.repeat(300)}.xlsx`);
    expect(result).toBe(`${'a'.repeat(115)}.xlsx`);
    expect(result?.length).toBe(120);
  });

  it('cuts a stem of astral characters by code point and never splits a surrogate pair', () => {
    const result = sanitizeUploadFilename(`${ASTRAL.repeat(200)}.xlsx`);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(codePoints(result)).toBe(120);
    expect(result.endsWith('.xlsx')).toBe(true);
    expect(isWellFormedText(result)).toBe(true);
  });

  it.each(['tariff.xls', '.xlsx', ''])('answers null for %j', (raw) => {
    expect(sanitizeUploadFilename(raw)).toBeNull();
  });
});

describe('cleanDisplayName', () => {
  it('drops format and control characters and trims', () => {
    expect(cleanDisplayName(`a${RIGHT_TO_LEFT_OVERRIDE}b${BELL} `, 120)).toBe('ab');
  });

  it('cuts to max code points and stays well formed', () => {
    const result = cleanDisplayName(ASTRAL.repeat(200), 120);
    expect(codePoints(result)).toBe(120);
    expect(isWellFormedText(result)).toBe(true);
  });

  it('trims the end a cut leaves', () => {
    expect(cleanDisplayName('abc def', 4)).toBe('abc');
  });
});

describe('NameSchema', () => {
  it('refuses 121 characters with NAME_TOO_LONG', () => {
    const result = NameSchema.safeParse('a'.repeat(121));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('NAME_TOO_LONG');
  });

  it('refuses a bidi override with NAME_INVALID_CHARACTERS', () => {
    const result = NameSchema.safeParse(`a${RIGHT_TO_LEFT_OVERRIDE}b`);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('NAME_INVALID_CHARACTERS');
  });
});

describe('contentDisposition', () => {
  it('writes an ASCII fallback and an RFC 8187 name that decodes back to the input', () => {
    const name = `${DOTTED_CAPITAL_I}ndirim "1".xlsx`;
    const header = contentDisposition(name);
    expect(header.startsWith('attachment; ')).toBe(true);
    expect(header).toContain('filename="_ndirim _1_.xlsx"');
    const encoded = /filename\*=UTF-8''(\S+)$/.exec(header)?.[1];
    expect(encoded).toBeDefined();
    if (encoded === undefined) return;
    expect(decodeURIComponent(encoded)).toBe(name);
  });

  it("percent-encodes the characters encodeURIComponent leaves: ' ( ) * !", () => {
    const header = contentDisposition('a(b)!.xlsx');
    expect(header).toContain('%28');
    expect(header).toContain('%29');
    expect(header).toContain('%21');
    expect(contentDisposition("it's*.xlsx")).toContain("filename*=UTF-8''it%27s%2A.xlsx");
  });

  it('replaces a lone surrogate instead of throwing', () => {
    const header = contentDisposition(`a${String.fromCodePoint(0xd800)}.xlsx`);
    expect(header).toContain('filename="a_.xlsx"');
    expect(header).toContain("filename*=UTF-8''a%EF%BF%BD.xlsx");
  });

  it('keeps parameter syntax out of the ASCII fallback, so the web client reads the whole name', () => {
    expect(sanitizeUploadFilename(SMUGGLED_NAME)).toBe(SMUGGLED_NAME);

    const header = contentDisposition(SMUGGLED_NAME);

    const parts = DISPOSITION_RE.exec(header);
    expect(parts?.[1]).toBe('rapor_filename__UTF-8__setup.exe_.xlsx');
    expect(parts?.[2]).toBe('rapor%3Bfilename%2A%3DUTF-8%27%27setup.exe%3B.xlsx');
    // The first `filename*=` is the parameter, after the fallback's closing quote.
    expect(header.indexOf('filename*=')).toBeGreaterThan(header.lastIndexOf('"'));
    expect(webClientFilename(header)).toBe(SMUGGLED_NAME);
  });

  it("replaces ; = * ' and % in the ASCII fallback", () => {
    expect(contentDisposition("a;b=c*d'e%f.xlsx")).toContain('filename="a_b_c_d_e_f.xlsx"');
  });

  it('keeps only letters, digits, space and . _ ( ) - in the ASCII fallback', () => {
    expect(contentDisposition('Rapor-1 (v2)_son.xlsx')).toContain(
      'filename="Rapor-1 (v2)_son.xlsx"',
    );
    expect(contentDisposition('a,b+c&d#e~f.xlsx')).toContain('filename="a_b_c_d_e_f.xlsx"');
  });
});
