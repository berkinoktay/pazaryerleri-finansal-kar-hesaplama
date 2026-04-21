import { describe, expect, it } from 'vitest';

import { slugify } from '@/lib/slugify';

describe('slugify', () => {
  it('lowercases and hyphenates a simple ASCII name', () => {
    expect(slugify('Akyildiz Ticaret')).toBe('akyildiz-ticaret');
  });

  it('handles Turkish precomposed ı and İ (no NFD decomposition path)', () => {
    expect(slugify('Akyıldız Ticaret')).toBe('akyildiz-ticaret');
    expect(slugify('İstanbul Ticaret')).toBe('istanbul-ticaret');
  });

  it('strips other Turkish diacritics via NFD', () => {
    expect(slugify('ŞEKER GIDA A.Ş.')).toBe('seker-gida-a-s');
    expect(slugify('Güneş Öztürk Çiftliği')).toBe('gunes-ozturk-ciftligi');
  });

  it('collapses runs of non-alphanumerics and trims leading/trailing hyphens', () => {
    expect(slugify('  foo  --  bar  ')).toBe('foo-bar');
    expect(slugify('...&&&foo&&&...')).toBe('foo');
  });

  it('returns empty string when input has no alphanumeric content', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('---')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('preserves digits', () => {
    expect(slugify('Store 42')).toBe('store-42');
    expect(slugify('2026 Vision')).toBe('2026-vision');
  });
});
