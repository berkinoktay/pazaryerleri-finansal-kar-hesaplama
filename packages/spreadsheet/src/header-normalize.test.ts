import { describe, it, expect } from 'vitest';
import { normalizeHeader, resolveHeaders } from './header-normalize';
import { SpreadsheetFileError } from './errors';
import { miniProductsSchema } from '../tests/fixtures/mini-schemas';

describe('normalizeHeader', () => {
  it('NFC-normalizes, trims, strips NBSP, collapses inner whitespace', () => {
    // U+00A0 NON-BREAKING SPACE
    const nbsp = '\u00a0';
    // U+0308 COMBINING DIAERESIS
    const combiningDiaeresis = '\u0308';

    // trim regular leading/trailing spaces
    expect(normalizeHeader('  Cost ')).toBe('Cost');

    // strip trailing NBSP
    expect(normalizeHeader(`Cost${nbsp}`)).toBe('Cost');

    // NFD -> NFC: 'U' (U+0055) + combining diaeresis (U+0308) + 'RUN'
    //   normalizes to precomposed U+00DC (LATIN CAPITAL U WITH DIAERESIS) + 'RUN'
    expect(normalizeHeader(`U${combiningDiaeresis}RUN`)).toBe('\u00dcRUN');

    // collapse multiple inner spaces to a single space
    expect(normalizeHeader('A   B')).toBe('A B');
  });
});

describe('resolveHeaders', () => {
  it('resolves an alias to the canonical header', () => {
    const out = resolveHeaders(miniProductsSchema, [
      'Key',
      'Barkod',
      'Title',
      'Cost',
      'Price',
      'Profit',
    ]);
    // 'Barkod' alias should resolve to the canonical 'Barcode'
    expect(out.canonicalHeaderRow[1]).toBe('Barcode');
    expect(out.presentKeys.has('barcode')).toBe(true);
  });

  it('records a missing optional header instead of throwing', () => {
    // Title is missing (optional -- no columnRequired)
    const out = resolveHeaders(miniProductsSchema, ['Key', 'Barcode', 'Cost', 'Price', 'Profit']);
    expect(out.missingExpectedHeaders).toContain('Title');
  });

  it('throws MISSING_REQUIRED_HEADERS when a columnRequired header is absent', () => {
    const call = () => resolveHeaders(miniProductsSchema, ['Barcode', 'Cost', 'Price', 'Profit']);
    expect(call).toThrow(SpreadsheetFileError);
    try {
      call();
    } catch (e) {
      if (e instanceof SpreadsheetFileError) {
        expect(e.code).toBe('MISSING_REQUIRED_HEADERS');
      }
    }
  });
});
