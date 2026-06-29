import { describe, it, expect } from 'vitest';
import { sanitizeCellText } from './sanitize';

describe('sanitizeCellText', () => {
  it.each(['=cmd', '+1', '-1', '@x', '\tx', '\rx', '\nx'])(
    'prefixes leading danger char %j',
    (s) => {
      expect(sanitizeCellText(s)).toBe(`'${s}`);
    },
  );
  it('detects danger after leading whitespace', () => {
    expect(sanitizeCellText('   =danger')).toBe(`'   =danger`);
  });
  it('leaves safe text untouched', () => {
    expect(sanitizeCellText('Barkod123')).toBe('Barkod123');
    expect(sanitizeCellText('')).toBe('');
    expect(sanitizeCellText('   ')).toBe('   ');
  });
  it('escapes a danger char hidden behind a non-breaking space (NBSP)', () => {
    expect(sanitizeCellText(' =HYPERLINK("x")')).toBe(`' =HYPERLINK("x")`);
  });
  it('leaves NBSP-prefixed safe text untouched', () => {
    expect(sanitizeCellText(' Barkod')).toBe(' Barkod');
  });
});
