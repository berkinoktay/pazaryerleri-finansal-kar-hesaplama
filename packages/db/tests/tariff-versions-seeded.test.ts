// Seed-level assertion for the dated tariff versions (tariff versioning, PR-1 task 1).
//
// Migration 20261120215534_shipping_tariff_versions gives every carrier one version
// starting 2000-01-01 (open towards the past), links every desi and Barem row to it,
// and starts the micro-export tier set at Istanbul midnight of its 2024-07-16 date.
// The test DB template is built with `prisma db push`, which never runs migration
// SQL, so test-support recreates those rows; this pins that it does.
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
    const [desiRows, baremRows] = await Promise.all([
      prisma.shippingDesiTariff.findMany({
        select: { id: true, carrierId: true, version: { select: { carrierId: true } } },
      }),
      prisma.shippingBaremTariff.findMany({
        select: { id: true, carrierId: true, version: { select: { carrierId: true } } },
      }),
    ]);
    expect(desiRows.length).toBeGreaterThan(0);
    expect(baremRows.length).toBeGreaterThan(0);

    // A row with no version, or a version of another carrier, is a mismatch.
    const mismatched = [...desiRows, ...baremRows].filter(
      (row) => row.version?.carrierId !== row.carrierId,
    );
    expect(mismatched).toEqual([]);

    const sendeoDesiZero = await prisma.shippingDesiTariff.findFirst({
      where: { desi: 0, version: { carrier: { platform: 'TRENDYOL', code: 'SENDEOMP' } } },
      select: { priceNet: true },
    });
    expect(sendeoDesiZero?.priceNet.toString()).toBe('91.99');
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
