// Seed-level assertion for shipping_carriers.order_cargo_names (Phase 4C fix).
//
// The order profit path matches an order's cargoProviderName against a carrier's
// display name OR its order_cargo_names. Trendyol writes the long getProviders
// "Name" (e.g. "PTT Kargo Marketplace") on orders while the seeded display name is
// the short "PTT Kargo", so the names must land in order_cargo_names at seed time
// for a real order to match. This pins that the reference seed carries every
// Trendyol carrier's getProviders name.
//
// Runs against the isolated test DB (vitest.config.ts remaps DATABASE_URL and wires
// no globalSetup for this package, so the seed is applied here). Turkish letters are
// built from their code points so the source stays ASCII.

import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/index';
import { ensureShippingReferenceData } from '../src/test-support';

// Turkish letters assembled from code points to keep this file ASCII-only.
const C_CEDILLA = String.fromCharCode(0xe7); // c with cedilla
const U_UMLAUT = String.fromCharCode(0xfc); // u with diaeresis

// getProviders "Name" per carrier code: the exact strings Trendyol writes on orders.
const EXPECTED_ORDER_CARGO_NAMES: Record<string, string> = {
  YKMP: `Yurti${C_CEDILLA}i Kargo Marketplace`,
  ARASMP: 'Aras Kargo Marketplace',
  SURATMP: `S${U_UMLAUT}rat Kargo Marketplace`,
  DHLECOMMP: 'DHL eCommerce Marketplace',
  TEXMP: 'Trendyol Express Marketplace',
  PTTMP: 'PTT Kargo Marketplace',
  SENDEOMP: 'Kolay Gelsin Marketplace',
  HOROZMP: 'Horoz Kargo Marketplace',
  CEVAMP: 'CEVA Marketplace',
  CEVATEDARIK: 'Ceva Tedarik Marketplace',
};

const CANONICAL_CODES = Object.keys(EXPECTED_ORDER_CARGO_NAMES);

describe('shipping_carriers reference seed carries the Trendyol order cargo names', () => {
  beforeAll(async () => {
    await ensureShippingReferenceData();
    // A test DB seeded before order_cargo_names existed keeps the 10 carriers with an
    // empty array, and ensureShippingReferenceData() no-ops on a full catalogue. Refresh
    // from the current seed when the names are missing: DELETE (never TRUNCATE, which the
    // reference-hygiene audit forbids) the canonical rows and reseed, leaving the fixture
    // at 10. On a fresh CI DB the first call already seeded them with the names, so this
    // branch never runs.
    const sample = await prisma.shippingCarrier.findFirst({
      where: { platform: 'TRENDYOL', code: 'PTTMP' },
      select: { orderCargoNames: true },
    });
    if (sample !== null && sample.orderCargoNames.length === 0) {
      const codeList = CANONICAL_CODES.map((code) => `'${code}'`).join(', ');
      await prisma.$executeRawUnsafe(
        `DELETE FROM shipping_carriers WHERE platform = 'TRENDYOL' AND code IN (${codeList})`,
      );
      await ensureShippingReferenceData();
    }
  });

  it('every Trendyol carrier carries its getProviders name in order_cargo_names', async () => {
    const carriers = await prisma.shippingCarrier.findMany({
      where: { platform: 'TRENDYOL', code: { in: CANONICAL_CODES } },
      select: { code: true, orderCargoNames: true },
    });
    expect(carriers).toHaveLength(CANONICAL_CODES.length);

    const namesByCode = new Map(carriers.map((carrier) => [carrier.code, carrier.orderCargoNames]));
    for (const [code, name] of Object.entries(EXPECTED_ORDER_CARGO_NAMES)) {
      expect(namesByCode.get(code)).toContain(name);
    }
  });
});
