import { describe, expect, it } from 'vitest';

import { filenameFromDisposition } from '@/features/campaigns/api/binary-download';

/**
 * `filenameFromDisposition` reads the download name from a `Content-Disposition`
 * header. It has three branches, each locked below:
 *   (a) the RFC 5987 `filename*=UTF-8''<pct-encoded>` form — our backend's format,
 *   (b) the plain `filename="..."` fallback when the RFC 5987 form is absent,
 *   (c) the defensive branches — no header, or malformed percent-encoding — both null.
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
});
