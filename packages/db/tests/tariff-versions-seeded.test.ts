// Seed-level assertion for the dated tariff versions (tariff versioning, PR-1).
//
// The reference seed (reference-seed/20261121090000_shipping_tariff_versions.sql and
// 20261121090100_micro_export_return_fee_tier_versions.sql) gives every carrier one
// version starting 2000-01-01 (open towards the past) holding its desi and Barem rows,
// and starts the micro-export tier set at Istanbul midnight of its 2024-07-16 date.
// The test DB template is built with `prisma db push` plus that seed, loaded through
// test-support; this pins that the loaded rows match.
//
// Read-only: the shared reference tables are never truncated or written here.

import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../src/index';
import { ensureMicroExportReturnTiers, ensureShippingReferenceData } from '../src/test-support';

const EXPECTED_CARRIER_COUNT = 10;
const FIRST_SHIPPING_VERSION_START = '2000-01-01T00:00:00.000Z';
// 2024-07-16 00:00 in Istanbul (UTC+3) as a UTC instant.
const FIRST_MICRO_EXPORT_VERSION_START = '2024-07-15T21:00:00.000Z';
const EXPECTED_MICRO_EXPORT_TIER_COUNT = 2;
// Every carrier's version prices desi 0 through 12.
const EXPECTED_DESI_ROWS_PER_CARRIER = 13;
// Carriers inside the Barem program carry two bands (0-199.99 and 200-349.99).
const BAREM_CARRIER_CODES = [
  'YKMP',
  'ARASMP',
  'SURATMP',
  'DHLECOMMP',
  'TEXMP',
  'PTTMP',
  'SENDEOMP',
];
const EXPECTED_BAREM_BANDS_PER_BAREM_CARRIER = 2;
// Carriers outside the Barem program carry no band.
const NON_BAREM_CARRIER_CODES = ['HOROZMP', 'CEVAMP', 'CEVATEDARIK'];
const EXPECTED_DESI_TOTAL = 130;
const EXPECTED_BAREM_TOTAL = 14;

describe('reference seed carries the dated tariff versions', () => {
  beforeAll(async () => {
    await ensureShippingReferenceData();
    await ensureMicroExportReturnTiers();
  });

  it('every seeded carrier has exactly one version starting 2000-01-01', async () => {
    const carriers = await prisma.shippingCarrier.findMany({
      select: {
        code: true,
        tariffVersions: {
          select: { effectiveFrom: true, supportsBaremDestek: true, maxBaremDesi: true },
        },
      },
    });
    expect(carriers).toHaveLength(EXPECTED_CARRIER_COUNT);

    for (const carrier of carriers) {
      expect(carrier.tariffVersions, carrier.code).toHaveLength(1);
      expect(carrier.tariffVersions[0]?.effectiveFrom.toISOString(), carrier.code).toBe(
        FIRST_SHIPPING_VERSION_START,
      );
    }

    const sendeo = carriers.find((carrier) => carrier.code === 'SENDEOMP');
    expect(sendeo?.tariffVersions[0]?.supportsBaremDestek).toBe(true);
    expect(sendeo?.tariffVersions[0]?.maxBaremDesi).toBe(10);
  });

  it("every seeded desi and Barem row belongs to its carrier's version", async () => {
    // A row reaches its carrier only through its (required) version, so a row of the
    // wrong carrier would surface as a wrong price below, not as a dangling link.
    const [desiCount, baremCount] = await Promise.all([
      prisma.shippingDesiTariff.count(),
      prisma.shippingBaremTariff.count(),
    ]);
    expect(desiCount).toBeGreaterThan(0);
    expect(baremCount).toBeGreaterThan(0);

    const sendeoBaremFirstBand = await prisma.shippingBaremTariff.findFirst({
      where: {
        minOrderAmount: 0,
        version: { carrier: { platform: 'TRENDYOL', code: 'SENDEOMP' } },
      },
      select: { maxOrderAmount: true, priceNet: true },
    });
    expect(sendeoBaremFirstBand?.maxOrderAmount.toString()).toBe('199.99');
    expect(sendeoBaremFirstBand?.priceNet.toString()).toBe('51.24');

    const sendeoDesiZero = await prisma.shippingDesiTariff.findFirst({
      where: { desi: 0, version: { carrier: { platform: 'TRENDYOL', code: 'SENDEOMP' } } },
      select: { priceNet: true },
    });
    expect(sendeoDesiZero?.priceNet.toString()).toBe('91.99');
  });

  it("every carrier's version holds its seeded desi and Barem rows", async () => {
    const [carriers, desiTotal, baremTotal] = await Promise.all([
      prisma.shippingCarrier.findMany({
        select: {
          code: true,
          tariffVersions: {
            select: { _count: { select: { desiTariffs: true, baremTariffs: true } } },
          },
        },
      }),
      prisma.shippingDesiTariff.count(),
      prisma.shippingBaremTariff.count(),
    ]);

    expect(carriers.map((carrier) => carrier.code).sort()).toEqual(
      [...BAREM_CARRIER_CODES, ...NON_BAREM_CARRIER_CODES].sort(),
    );
    for (const carrier of carriers) {
      const rowCounts = carrier.tariffVersions[0]?._count;
      const expectedBaremBands = BAREM_CARRIER_CODES.includes(carrier.code)
        ? EXPECTED_BAREM_BANDS_PER_BAREM_CARRIER
        : 0;
      expect(rowCounts?.desiTariffs, carrier.code).toBe(EXPECTED_DESI_ROWS_PER_CARRIER);
      expect(rowCounts?.baremTariffs, carrier.code).toBe(expectedBaremBands);
    }
    expect(desiTotal).toBe(EXPECTED_DESI_TOTAL);
    expect(baremTotal).toBe(EXPECTED_BAREM_TOTAL);
  });

  it('every seeded Barem row is table 1 and no seeded version prices returns at Barem', async () => {
    // The seed predates the 10 August 2026 two-table rule: its bands are table 1
    // and its versions keep the returns flag off. Totals are pinned so an empty
    // table cannot pass the "every row" checks.
    const [baremTotal, tableOneTotal, versionTotal, returnsOffTotal] = await Promise.all([
      prisma.shippingBaremTariff.count(),
      prisma.shippingBaremTariff.count({ where: { tier: 'TABLE_1' } }),
      prisma.shippingTariffVersion.count(),
      prisma.shippingTariffVersion.count({ where: { baremAppliesToReturns: false } }),
    ]);

    expect(baremTotal).toBe(EXPECTED_BAREM_TOTAL);
    expect(tableOneTotal).toBe(EXPECTED_BAREM_TOTAL);
    expect(versionTotal).toBe(EXPECTED_CARRIER_COUNT);
    expect(returnsOffTotal).toBe(EXPECTED_CARRIER_COUNT);
  });

  it('micro-export tiers belong to one version starting at Istanbul midnight of 2024-07-16', async () => {
    const [versions, tierCount] = await Promise.all([
      prisma.microExportReturnFeeTierVersion.findMany({
        select: { effectiveFrom: true, _count: { select: { tiers: true } } },
      }),
      prisma.microExportReturnFeeTier.count(),
    ]);

    expect(versions).toHaveLength(1);
    expect(versions[0]?.effectiveFrom.toISOString()).toBe(FIRST_MICRO_EXPORT_VERSION_START);
    expect(tierCount).toBe(EXPECTED_MICRO_EXPORT_TIER_COUNT);
    expect(versions[0]?._count.tiers).toBe(EXPECTED_MICRO_EXPORT_TIER_COUNT);
  });
});
