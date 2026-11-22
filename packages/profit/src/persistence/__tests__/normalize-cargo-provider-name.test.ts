/**
 * Unit tests for `normalizeCargoProviderName`, the single key an order's cargo name and
 * a carrier's names are compared by. No DB. Turkish letters are written as code point
 * escapes so a tool that rewrites the source cannot silently compose or decompose them.
 */

import { describe, expect, it } from 'vitest';

import { normalizeCargoProviderName } from '../normalize-cargo-provider-name';
import { TRENDYOL_CARRIER_NAMES } from './fixtures/trendyol-carrier-names';

// The canonical normalised spelling of the Yurtici carrier name (with a c-cedilla).
const YURTICI = 'yurti\u{00E7}i';

describe('normalizeCargoProviderName', () => {
  it('folds every Turkish and ASCII I to a plain i', () => {
    // U+0130 (dotted capital I), U+0049 (ASCII I), U+0131 (dotless i), U+0069 (i).
    expect(normalizeCargoProviderName('\u{0130}')).toBe('i');
    expect(normalizeCargoProviderName('I')).toBe('i');
    expect(normalizeCargoProviderName('\u{0131}')).toBe('i');
    expect(normalizeCargoProviderName('i')).toBe('i');

    expect(normalizeCargoProviderName('YURT\u{0130}\u{00C7}\u{0130}')).toBe(YURTICI);
    expect(normalizeCargoProviderName('YURTI\u{00C7}I')).toBe(YURTICI);
    expect(normalizeCargoProviderName('yurt\u{0131}\u{00E7}\u{0131}')).toBe(YURTICI);
    expect(normalizeCargoProviderName('Yurti\u{00E7}i')).toBe(YURTICI);
  });

  it('does not fold ASCII I to a dotless i like the tr-TR locale would', () => {
    expect(normalizeCargoProviderName('DHL')).toBe('dhl');
    expect(normalizeCargoProviderName('CEVA TEDARIK')).toBe('ceva tedarik');
  });

  it('composes decomposed letters before comparing (NFC)', () => {
    // I + U+0307 is the decomposed dotted capital I; C + U+0327 is a decomposed C-cedilla.
    expect(normalizeCargoProviderName('YURTI\u{0307}C\u{0327}I\u{0307}')).toBe(YURTICI);
    // u + U+0308 is a decomposed u-umlaut.
    expect(normalizeCargoProviderName('Su\u{0308}rat Kargo')).toBe('s\u{00FC}rat kargo');
  });

  it('drops the combining dot a non-Turkish lowercase leaves on i', () => {
    // A root-locale lowercase of U+0130 yields i + U+0307, which NFC does not compose.
    expect(normalizeCargoProviderName('yurti\u{0307}\u{00E7}i\u{0307}')).toBe(YURTICI);
    expect(normalizeCargoProviderName('YURT\u{0130}\u{00C7}\u{0130}'.toLowerCase())).toBe(YURTICI);
  });

  it('collapses spaces and punctuation to single spaces', () => {
    expect(normalizeCargoProviderName('DHL-eCommerce Marketplace')).toBe(
      'dhl ecommerce marketplace',
    );
    expect(normalizeCargoProviderName('  PTT  KARGO  MARKETPLACE. ')).toBe('ptt kargo marketplace');
    expect(normalizeCargoProviderName('Trendyol\tExpress\nMarketplace')).toBe(
      'trendyol express marketplace',
    );
    expect(normalizeCargoProviderName('Kargo_2/Go')).toBe('kargo 2 go');
  });

  it('returns an empty key for a blank or punctuation-only name', () => {
    expect(normalizeCargoProviderName('')).toBe('');
    expect(normalizeCargoProviderName('   ')).toBe('');
    expect(normalizeCargoProviderName('\t\n')).toBe('');
    expect(normalizeCargoProviderName('***')).toBe('');
  });

  it('gives every carrier a distinct normalised key', () => {
    // A key owned by two carriers would leave every order with that name unrecognised.
    const ownerByKey = new Map<string, string>();
    for (const carrier of TRENDYOL_CARRIER_NAMES) {
      for (const name of [carrier.displayName, ...carrier.orderCargoNames]) {
        const key = normalizeCargoProviderName(name);
        expect(key, name).not.toBe('');
        const owner = ownerByKey.get(key);
        if (owner !== undefined) {
          expect(owner, `${name} -> ${key}`).toBe(carrier.code);
        }
        ownerByKey.set(key, carrier.code);
      }
    }
    expect(ownerByKey.size).toBeGreaterThan(0);
  });
});
