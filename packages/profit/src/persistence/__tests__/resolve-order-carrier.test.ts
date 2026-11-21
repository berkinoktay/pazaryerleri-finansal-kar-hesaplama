/**
 * Unit tests for the pure `resolveOrderCarrier` helper. No DB: the helper decides which
 * active carrier an order's shipping estimate should use from the order's cargo name and
 * the active carriers. The store default is NOT consulted on an order (owner decision
 * 2026-11-09), so a name it cannot recognize resolves to null and the loader then
 * estimates a zero shipping line.
 *
 * The data here is REAL: Trendyol writes the getProviders "Name" ("PTT Kargo
 * Marketplace") on orders, while the seeded carrier display name is the short "PTT
 * Kargo". The long name lives in orderCargoNames, so the match must consider both.
 */

import { describe, expect, it } from 'vitest';

import {
  reportedProviderName,
  resolveOrderCarrier,
  type CarrierRow,
} from '../load-trendyol-parcel';

const PTT: CarrierRow = {
  id: 'carrier-ptt',
  code: 'PTTMP',
  displayName: 'PTT Kargo',
  orderCargoNames: ['PTT Kargo Marketplace'],
};
const TEX: CarrierRow = {
  id: 'carrier-tex',
  code: 'TEXMP',
  displayName: 'Trendyol Express',
  orderCargoNames: ['Trendyol Express Marketplace'],
};

describe('resolveOrderCarrier', () => {
  it("matches Trendyol's marketplace cargo name to its carrier", () => {
    const carriers = [PTT, TEX];
    // The real pair: display name "PTT Kargo", order name "PTT Kargo Marketplace".
    expect(resolveOrderCarrier('PTT Kargo Marketplace', carriers)).toBe(PTT);
    // Case and surrounding spaces do not matter (trim + toLowerCase on both sides).
    expect(resolveOrderCarrier('  ptt kargo marketplace  ', carriers)).toBe(PTT);
  });

  it('matches the short display name too', () => {
    const carriers = [PTT, TEX];
    // An order carrying the bare display name (no " Marketplace" suffix) still matches.
    expect(resolveOrderCarrier('Trendyol Express', carriers)).toBe(TEX);
  });

  it('maps an aliased marketplace cargo name to its carrier', () => {
    const carriers = [PTT, TEX];
    // Both the display name and the getProviders name resolve to the same carrier.
    expect(resolveOrderCarrier('Trendyol Express', carriers)).toBe(TEX);
    expect(resolveOrderCarrier('Trendyol Express Marketplace', carriers)).toBe(TEX);
  });

  it('returns null when two carriers claim the same name', () => {
    // Two distinct active carriers both list the order's cargo name: the match is
    // ambiguous, so the carrier is not recognized rather than a silent pick of one.
    const dupA: CarrierRow = {
      id: 'carrier-dup-a',
      code: 'DUPAMP',
      displayName: 'Dup A',
      orderCargoNames: ['Shared Kargo Marketplace'],
    };
    const dupB: CarrierRow = {
      id: 'carrier-dup-b',
      code: 'DUPBMP',
      displayName: 'Dup B',
      orderCargoNames: ['Shared Kargo Marketplace'],
    };
    expect(resolveOrderCarrier('Shared Kargo Marketplace', [dupA, dupB])).toBeNull();
  });

  it("returns null when the order's cargo name is unknown or blank", () => {
    const carriers = [PTT, TEX];
    // A null name, a blank name, an "Alternative Delivery", a masked "***" and any other
    // unknown name are all not recognized -- the loader then estimates zero shipping.
    expect(resolveOrderCarrier(null, carriers)).toBeNull();
    expect(resolveOrderCarrier('', carriers)).toBeNull();
    expect(resolveOrderCarrier('   ', carriers)).toBeNull();
    expect(resolveOrderCarrier('Alternative Delivery', carriers)).toBeNull();
    expect(resolveOrderCarrier('***', carriers)).toBeNull();
  });

  it('returns null for an inactive carrier with the same name', () => {
    // The query passes only active carriers, so an inactive namesake never reaches the
    // helper: TEX is inactive here (absent from the list), so an order naming it is not
    // recognized rather than resolved to the dropped inactive row.
    const activeCarriers = [PTT];
    expect(resolveOrderCarrier('Trendyol Express Marketplace', activeCarriers)).toBeNull();
  });
});

describe('reportedProviderName', () => {
  it('keeps the name as Trendyol wrote it', () => {
    expect(reportedProviderName('Alternative Delivery')).toBe('Alternative Delivery');
    expect(reportedProviderName(' PTT Kargo Marketplace ')).toBe(' PTT Kargo Marketplace ');
  });

  it('reports null for a missing or blank name', () => {
    // The frontend falls back to its "unknown carrier" label on null, never on ''.
    expect(reportedProviderName(null)).toBeNull();
    expect(reportedProviderName('')).toBeNull();
    expect(reportedProviderName('   ')).toBeNull();
  });
});
