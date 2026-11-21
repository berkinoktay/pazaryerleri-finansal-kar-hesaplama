/**
 * Integration tests for the dated shipping tariff and micro-export tier reads: the
 * carrier tariff version in force at an instant (loadShippingTariffVersion), the
 * engine's shipping tariff loader built on it (loadShippingTariff), and the
 * micro-export return tiers resolved through loadFeeParams.
 *
 * The tariff and tier tables are platform-global reference data. The suite never
 * truncates them: it creates its own TEST_-prefixed carrier (two versions) and a 2099
 * micro-export tier version, and deletes exactly those afterwards (their rows
 * cascade). No tenant data is needed: loadShippingTariff takes the storeId only for
 * the store's own tariff read, so an unknown store id simply has no own rows.
 *
 * Requires: `supabase start` + `pnpm db:test-setup` before running.
 */

import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@pazarsync/db';
import { FeeCalculationKind, FeeScope, OrderFeeType, Platform } from '@pazarsync/db/enums';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadShippingTariffVersion } from '../../shipping/tariff-version';
import { loadFeeParams, loadShippingTariff } from '../trendyol-reference-loaders';
import { ensureDbReachable, seedMelontikFeeDefinitions } from './helpers/melontik-parcel';

const CARRIER_CODE = 'TEST_VERSIONING';
const CARRIER_EXTERNAL_ID = 990_101;
const CARRIER_DISPLAY_NAME = 'Test Versioning';
const CARRIER_ORDER_CARGO_NAME = 'Test Versioning Kargo';

/** v1 is open towards the past, like the migrated catalogue. */
const V1_START = new Date('2000-01-01T00:00:00.000Z');
/** v2 starts on 1 December 2026 at 00:00 in Istanbul (UTC+3). */
const V2_START = new Date('2026-11-30T21:00:00.000Z');

/** A micro-export tier set far in the future with a single band that retires both seeded bands. */
const MICRO_2099_START = new Date('2099-01-01T00:00:00.000Z');

let carrierId = '';
let v1Id = '';
let v2Id = '';

/** Removes this suite's carrier (versions and rows cascade) and its 2099 micro-export version. */
async function deleteSuiteReferenceRows(): Promise<void> {
  await prisma.shippingCarrier.deleteMany({
    where: { platform: Platform.TRENDYOL, code: CARRIER_CODE },
  });
  await prisma.microExportReturnFeeTierVersion.deleteMany({
    where: { effectiveFrom: MICRO_2099_START },
  });
}

/**
 * Replaces every fee definition with the set loadFeeParams resolves for an export
 * order. Other files on the same worker empty fee_definitions only before their own
 * tests and leave their rows behind when they finish (one leaves a later
 * PLATFORM_SERVICE row with no fixed amount), so the table is emptied first rather
 * than added to. fee_definitions is per-test ground, not the shared shipping fixture.
 */
async function seedExportFeeDefinitions(): Promise<void> {
  await prisma.feeDefinition.deleteMany({});
  await seedMelontikFeeDefinitions();
  await prisma.feeDefinition.createMany({
    data: [
      {
        platform: FeeScope.TRENDYOL,
        feeType: OrderFeeType.INTERNATIONAL_SERVICE,
        displayName: 'Uluslararasi Hizmet Bedeli',
        calculationKind: FeeCalculationKind.RATE_OF_SALE,
        rateOfSale: '0.0600',
        defaultVatRate: '20.00',
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
    ],
  });
}

describe('dated shipping tariff and micro-export tier reads', () => {
  beforeAll(async () => {
    await ensureDbReachable();
    await deleteSuiteReferenceRows();

    const carrier = await prisma.shippingCarrier.create({
      data: {
        platform: Platform.TRENDYOL,
        externalId: CARRIER_EXTERNAL_ID,
        code: CARRIER_CODE,
        displayName: CARRIER_DISPLAY_NAME,
        orderCargoNames: [CARRIER_ORDER_CARGO_NAME],
      },
    });
    carrierId = carrier.id;

    const v1 = await prisma.shippingTariffVersion.create({
      data: {
        carrierId,
        effectiveFrom: V1_START,
        supportsBaremDestek: true,
        maxBaremDesi: 10,
        maxBaremEligibleDeliveryDuration: 1,
        desiTariffs: {
          create: [{ desi: 1, priceNet: '100.00' }],
        },
        baremTariffs: {
          create: [{ minOrderAmount: '0.00', maxOrderAmount: '199.99', priceNet: '50.00' }],
        },
      },
    });
    v1Id = v1.id;

    const v2 = await prisma.shippingTariffVersion.create({
      data: {
        carrierId,
        effectiveFrom: V2_START,
        supportsBaremDestek: false,
        maxBaremDesi: 10,
        maxBaremEligibleDeliveryDuration: 1,
        desiTariffs: {
          create: [{ desi: 1, priceNet: '120.00' }],
        },
      },
    });
    v2Id = v2.id;

    await prisma.microExportReturnFeeTierVersion.create({
      data: {
        effectiveFrom: MICRO_2099_START,
        tiers: {
          create: [{ minSaleGross: '0.00', maxSaleGross: '99999999.99', rate: '0.2500' }],
        },
      },
    });
  });

  afterAll(async () => {
    await deleteSuiteReferenceRows();
  });

  it('loadShippingTariffVersion picks v1 one millisecond before Istanbul midnight', async () => {
    const version = await loadShippingTariffVersion(prisma, {
      carrierId,
      at: new Date('2026-11-30T20:59:59.999Z'),
    });

    expect(version?.versionId).toBe(v1Id);
    const desiOne = version?.desiRows.find((row) => row.desi === 1);
    expect(desiOne?.priceNet.toString()).toBe('100');
  });

  it('loadShippingTariffVersion picks v2 at Istanbul midnight', async () => {
    const version = await loadShippingTariffVersion(prisma, {
      carrierId,
      at: new Date('2026-11-30T21:00:00.000Z'),
    });

    expect(version?.versionId).toBe(v2Id);
    expect(version?.supportsBaremDestek).toBe(false);
  });

  it('loadShippingTariffVersion returns null before the first version', async () => {
    const version = await loadShippingTariffVersion(prisma, {
      carrierId,
      at: new Date('1999-12-31T23:59:59Z'),
    });

    expect(version).toBeNull();
  });

  it('a second version with the same carrier and start is rejected', async () => {
    let rejection: unknown = null;
    try {
      await prisma.shippingTariffVersion.create({
        data: {
          carrierId,
          effectiveFrom: V2_START,
          supportsBaremDestek: true,
          maxBaremDesi: 10,
          maxBaremEligibleDeliveryDuration: 1,
        },
      });
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    if (rejection instanceof Prisma.PrismaClientKnownRequestError) {
      expect(rejection.code).toBe('P2002');
    }
  });

  it('loadShippingTariff uses the version in force at the order date', async () => {
    const storeId = randomUUID();
    const carrier = { id: carrierId, code: CARRIER_CODE };

    const inV1 = await loadShippingTariff(prisma, {
      storeId,
      source: 'TRENDYOL_CONTRACT',
      carrier,
      at: new Date('2026-06-01T00:00:00Z'),
    });
    expect(inV1.desiTariffNet.get('1')?.toString()).toBe('100');
    expect(inV1.baremBands).toHaveLength(1);

    const inV2 = await loadShippingTariff(prisma, {
      storeId,
      source: 'TRENDYOL_CONTRACT',
      carrier,
      at: new Date('2026-12-15T00:00:00Z'),
    });
    expect(inV2.desiTariffNet.get('1')?.toString()).toBe('120');
    expect(inV2.carrier?.supportsBarem).toBe(false);
  });

  it('loadShippingTariff with no version in force yields empty tariffs', async () => {
    const tariff = await loadShippingTariff(prisma, {
      storeId: randomUUID(),
      source: 'TRENDYOL_CONTRACT',
      carrier: { id: carrierId, code: CARRIER_CODE },
      at: new Date('1999-06-01T00:00:00Z'),
    });

    expect(tariff.desiTariffNet.size).toBe(0);
    expect(tariff.baremBands).toHaveLength(0);
    // The carrier is still named, but without a version it offers no Barem.
    expect(tariff.carrier?.code).toBe(CARRIER_CODE);
    expect(tariff.carrier?.supportsBarem).toBe(false);
  });

  it('a retired micro-export band is not applied after the new version', async () => {
    await seedExportFeeDefinitions();

    const after2099 = await loadFeeParams(prisma, {
      orderDate: new Date('2099-02-01T00:00:00Z'),
      isExport: true,
      fastDeliveryType: null,
    });
    expect(after2099.overseasReturnTiers).toHaveLength(1);
    expect(after2099.overseasReturnTiers[0]?.ratePct.toString()).toBe('25');

    const in2026 = await loadFeeParams(prisma, {
      orderDate: new Date('2026-06-01T00:00:00Z'),
      isExport: true,
      fastDeliveryType: null,
    });
    expect(in2026.overseasReturnTiers.map((tier) => tier.ratePct.toString())).toEqual(['35', '30']);
  });
});
