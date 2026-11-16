import { describe, expect, it } from 'vitest';

import { filenameFromDisposition } from '@/features/campaigns/api/binary-download';

/**
 * `filenameFromDisposition` reads the download name from a `Content-Disposition`
 * header. It has three branches, each locked below:
 *   (a) the RFC 5987 `filename*=UTF-8''<pct-encoded>` form — our backend's format,
 *   (b) the plain `filename="..."` fallback when the RFC 5987 form is absent,
 *   (c) the defensive branches — no header, or a malformed percent-encoding with no plain
 *       `filename` to fall back to — both null.
 */
describe('filenameFromDisposition', () => {
  describe('RFC 5987 filename*=UTF-8 branch (percent-decoded)', () => {
    it('reads an ASCII name from the filename* form', () => {
      const header = "attachment; filename*=UTF-8''plus-komisyon-tarifesi.zip";

      expect(filenameFromDisposition(header)).toBe('plus-komisyon-tarifesi.zip');
    });

    it('percent-decodes a Turkish-character name back to its UTF-8 form', () => {
      // %C3%BC is the UTF-8 encoding of "ü"; the backend sends Turkish filenames
      // through the RFC 5987 form precisely because the plain form cannot carry them.
      const header = "attachment; filename*=UTF-8''%C3%BCr%C3%BCn-komisyon-tarifesi-7-gunluk.xlsx";

      expect(filenameFromDisposition(header)).toBe('ürün-komisyon-tarifesi-7-gunluk.xlsx');
    });

    it('prefers the filename* form over a plain filename in the same header', () => {
      // When both forms are present the RFC 5987 form wins (it is matched first),
      // so the decoded UTF-8 name is returned, not the ASCII-degraded plain one.
      const header = 'attachment; filename*=UTF-8\'\'%C3%BCr%C3%BCn.xlsx; filename="urun.xlsx"';

      expect(filenameFromDisposition(header)).toBe('ürün.xlsx');
    });
  });

  describe('plain filename="..." fallback branch', () => {
    it('reads a quoted plain filename when no filename* form is present', () => {
      const header = 'attachment; filename="urun-komisyon-tarifesi.xlsx"';

      expect(filenameFromDisposition(header)).toBe('urun-komisyon-tarifesi.xlsx');
    });
  });

  describe('defensive branches (return null)', () => {
    it('returns null when the header is absent', () => {
      expect(filenameFromDisposition(null)).toBeNull();
    });

    it('returns null when the header carries no filename token at all', () => {
      expect(filenameFromDisposition('attachment')).toBeNull();
    });

    it('returns null when the filename* percent-encoding is malformed', () => {
      // `%zz` is not a valid percent escape, so decodeURIComponent throws and the
      // helper swallows it into null rather than surfacing a corrupt name.
      const header = "attachment; filename*=UTF-8''%zz-broken.xlsx";

      expect(filenameFromDisposition(header)).toBeNull();
    });
  });

  describe("reads only the header's own filename* and filename parameters", () => {
    // Built from its code point, so these cases stay ASCII.
    const SMALL_U_DIAERESIS = String.fromCodePoint(0x00fc);

    const CASES: ReadonlyArray<{
      readonly why: string;
      readonly header: string;
      readonly expected: string | null;
    }> = [
      {
        why: 'keeps a quoted filename whole when its value holds filename*= and ;',
        header: `attachment; filename="rapor;filename*=UTF-8''setup.exe;.xlsx"`,
        expected: "rapor;filename*=UTF-8''setup.exe;.xlsx",
      },
      {
        why: 'prefers filename* whatever the parameter order',
        header: 'attachment; filename="a.xlsx"; filename*=UTF-8\'\'%C3%BCr%C3%BCn.xlsx',
        expected: `${SMALL_U_DIAERESIS}r${SMALL_U_DIAERESIS}n.xlsx`,
      },
      {
        why: 'ignores a parameter whose name only ends in filename*',
        header: 'attachment; x-filename*=UTF-8\'\'evil.exe; filename="a.xlsx"',
        expected: 'a.xlsx',
      },
      {
        why: 'compares the parameter name and the charset case-insensitively',
        header: "attachment; FILENAME*=utf-8''a.xlsx",
        expected: 'a.xlsx',
      },
      {
        why: 'unescapes a quoted pair in a quoted filename',
        header: 'attachment; filename="a\\"b.xlsx"',
        expected: 'a"b.xlsx',
      },
      {
        why: 'does not split at a semicolon after an escaped quote inside a quoted filename',
        header: 'attachment; filename="a\\";b.xlsx"',
        expected: 'a";b.xlsx',
      },
      {
        why: 'falls back to filename when filename* does not decode',
        header: 'attachment; filename*=UTF-8\'\'%zz.xlsx; filename="b.xlsx"',
        expected: 'b.xlsx',
      },
      {
        why: 'answers null when filename* does not decode and there is no filename',
        header: "attachment; filename*=UTF-8''%zz.xlsx",
        expected: null,
      },
      {
        why: 'answers null for an empty quoted filename',
        header: 'attachment; filename=""',
        expected: null,
      },
    ];

    it.each(CASES)('$why', ({ header, expected }) => {
      expect(filenameFromDisposition(header)).toBe(expected);
    });
  });
});
