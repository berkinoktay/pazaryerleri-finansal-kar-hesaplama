/**
 * Unit tests for the pure `resolveOrderCarrier` helper (Phase 4C, Gorev 1). No DB:
 * the helper decides which carrier an order's shipping estimate should use from the
 * order's cargo name, the active carriers, and the store default. The display names
 * here are synthetic ASCII stand-ins for the real Trendyol getProviders names.
 */

import { describe, expect, it } from 'vitest';

import { resolveOrderCarrier, type CarrierRow } from '../load-trendyol-parcel';

const PTT: CarrierRow = {
  id: 'carrier-ptt',
  code: 'PTTMP',
  displayName: 'PTT Kargo Marketplace',
  supportsBaremDestek: true,
  maxBaremDesi: 10,
};
const ARAS: CarrierRow = {
  id: 'carrier-aras',
  code: 'ARASMP',
  displayName: 'Aras Kargo Marketplace',
  supportsBaremDestek: true,
  maxBaremDesi: 10,
};
const STORE_DEFAULT: CarrierRow = {
  id: 'carrier-default',
  code: 'YKMP',
  displayName: 'Default Kargo Marketplace',
  supportsBaremDestek: true,
  maxBaremDesi: 10,
};

describe('resolveOrderCarrier', () => {
  it('matches the cargo name to the carrier regardless of case and surrounding spaces', () => {
    const carriers = [PTT, ARAS];
    expect(resolveOrderCarrier('  aras kargo marketplace  ', carriers, STORE_DEFAULT)).toBe(ARAS);
    expect(resolveOrderCarrier('PTT KARGO MARKETPLACE', carriers, STORE_DEFAULT)).toBe(PTT);
    expect(resolveOrderCarrier('Aras Kargo Marketplace', carriers, STORE_DEFAULT)).toBe(ARAS);
  });

  it("falls back to the store carrier when the order's cargo name is unknown", () => {
    const carriers = [PTT, ARAS];
    // A null name, a blank name and an "Alternative Delivery" all fall back to the
    // store default, exactly as the loader did before the order-carrier match.
    expect(resolveOrderCarrier(null, carriers, STORE_DEFAULT)).toBe(STORE_DEFAULT);
    expect(resolveOrderCarrier('', carriers, STORE_DEFAULT)).toBe(STORE_DEFAULT);
    expect(resolveOrderCarrier('   ', carriers, STORE_DEFAULT)).toBe(STORE_DEFAULT);
    expect(resolveOrderCarrier('Alternative Delivery', carriers, STORE_DEFAULT)).toBe(
      STORE_DEFAULT,
    );
    // With no carrier to match AND no store default, the result is null (the loader
    // then estimates with no carrier, exactly as a store with no default did).
    expect(resolveOrderCarrier('Alternative Delivery', carriers, null)).toBeNull();
  });

  it('ignores an inactive carrier with the same name', () => {
    // The query passes only active carriers, so an inactive namesake never reaches
    // the helper: ARAS is inactive here (absent from the list), so an order naming it
    // falls back to the store default rather than the dropped inactive row.
    const activeCarriers = [PTT];
    expect(resolveOrderCarrier('Aras Kargo Marketplace', activeCarriers, STORE_DEFAULT)).toBe(
      STORE_DEFAULT,
    );
  });
});
