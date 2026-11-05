/**
 * Unit tests for the pure `resolveOrderCarrier` helper (Phase 4C, Gorev 1). No DB:
 * the helper decides which carrier an order's shipping estimate should use from the
 * order's cargo name, the active carriers, and the store default.
 *
 * The data here is REAL: Trendyol writes the getProviders "Name" ("PTT Kargo
 * Marketplace") on orders, while the seeded carrier display name is the short "PTT
 * Kargo". The long name lives in orderCargoNames, so the match must consider both.
 * Turkish letters are built from code points to keep the source ASCII.
 */

import { describe, expect, it } from 'vitest';

import { resolveOrderCarrier, type CarrierRow } from '../load-trendyol-parcel';

// Turkish letters assembled from code points to keep this file ASCII-only.
const C_CEDILLA = String.fromCharCode(0xe7); // c with cedilla

const PTT: CarrierRow = {
  id: 'carrier-ptt',
  code: 'PTTMP',
  displayName: 'PTT Kargo',
  orderCargoNames: ['PTT Kargo Marketplace'],
  supportsBaremDestek: true,
  maxBaremDesi: 10,
};
const TEX: CarrierRow = {
  id: 'carrier-tex',
  code: 'TEXMP',
  displayName: 'Trendyol Express',
  orderCargoNames: ['Trendyol Express Marketplace'],
  supportsBaremDestek: true,
  maxBaremDesi: 10,
};
const STORE_DEFAULT: CarrierRow = {
  id: 'carrier-default',
  code: 'YKMP',
  displayName: `Yurti${C_CEDILLA}i Kargo`,
  orderCargoNames: [`Yurti${C_CEDILLA}i Kargo Marketplace`],
  supportsBaremDestek: true,
  maxBaremDesi: 10,
};

describe('resolveOrderCarrier', () => {
  it("matches Trendyol's marketplace cargo name to its carrier", () => {
    const carriers = [PTT, TEX];
    // The real pair: display name "PTT Kargo", order name "PTT Kargo Marketplace".
    expect(resolveOrderCarrier('PTT Kargo Marketplace', carriers, STORE_DEFAULT)).toBe(PTT);
    // Case and surrounding spaces do not matter (trim + toLowerCase on both sides).
    expect(resolveOrderCarrier('  ptt kargo marketplace  ', carriers, STORE_DEFAULT)).toBe(PTT);
  });

  it('matches the short display name too', () => {
    const carriers = [PTT, TEX];
    // An order carrying the bare display name (no " Marketplace" suffix) still matches.
    expect(resolveOrderCarrier('Trendyol Express', carriers, STORE_DEFAULT)).toBe(TEX);
  });

  it('maps an aliased marketplace cargo name to its carrier', () => {
    const carriers = [PTT, TEX];
    // Both the display name and the getProviders name resolve to the same carrier.
    expect(resolveOrderCarrier('Trendyol Express', carriers, STORE_DEFAULT)).toBe(TEX);
    expect(resolveOrderCarrier('Trendyol Express Marketplace', carriers, STORE_DEFAULT)).toBe(TEX);
  });

  it('falls back to the store carrier when two carriers claim the same name', () => {
    // Two distinct active carriers both list the order's cargo name: the match is
    // ambiguous, so the store default is used rather than a silent pick of one.
    const dupA: CarrierRow = {
      id: 'carrier-dup-a',
      code: 'DUPAMP',
      displayName: 'Dup A',
      orderCargoNames: ['Shared Kargo Marketplace'],
      supportsBaremDestek: true,
      maxBaremDesi: 10,
    };
    const dupB: CarrierRow = {
      id: 'carrier-dup-b',
      code: 'DUPBMP',
      displayName: 'Dup B',
      orderCargoNames: ['Shared Kargo Marketplace'],
      supportsBaremDestek: true,
      maxBaremDesi: 10,
    };
    expect(resolveOrderCarrier('Shared Kargo Marketplace', [dupA, dupB], STORE_DEFAULT)).toBe(
      STORE_DEFAULT,
    );
  });

  it("falls back to the store carrier when the order's cargo name is unknown or blank", () => {
    const carriers = [PTT, TEX];
    // A null name, a blank name, an "Alternative Delivery", a masked "***" and any other
    // unknown name all fall back to the store default, exactly as before the match.
    expect(resolveOrderCarrier(null, carriers, STORE_DEFAULT)).toBe(STORE_DEFAULT);
    expect(resolveOrderCarrier('', carriers, STORE_DEFAULT)).toBe(STORE_DEFAULT);
    expect(resolveOrderCarrier('   ', carriers, STORE_DEFAULT)).toBe(STORE_DEFAULT);
    expect(resolveOrderCarrier('Alternative Delivery', carriers, STORE_DEFAULT)).toBe(
      STORE_DEFAULT,
    );
    expect(resolveOrderCarrier('***', carriers, STORE_DEFAULT)).toBe(STORE_DEFAULT);
    // With no carrier to match AND no store default, the result is null (the loader
    // then estimates with no carrier, exactly as a store with no default did).
    expect(resolveOrderCarrier('Alternative Delivery', carriers, null)).toBeNull();
  });

  it('ignores an inactive carrier with the same name', () => {
    // The query passes only active carriers, so an inactive namesake never reaches the
    // helper: TEX is inactive here (absent from the list), so an order naming it falls
    // back to the store default rather than the dropped inactive row.
    const activeCarriers = [PTT];
    expect(resolveOrderCarrier('Trendyol Express Marketplace', activeCarriers, STORE_DEFAULT)).toBe(
      STORE_DEFAULT,
    );
  });
});
