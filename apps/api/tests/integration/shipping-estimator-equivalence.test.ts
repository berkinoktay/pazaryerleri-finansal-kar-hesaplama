/**
 * Equivalence test: `estimateShippingCostForVariant` (the canonical service)
 * vs `SHIPPING_ESTIMATE_CTE_SQL` (the raw-SQL performance mirror used by the
 * products list endpoint).
 *
 * The SQL CTE inlines the same algorithm as the service to avoid N+1 lookups
 * on a paginated list. The two implementations must agree on every documented
 * outcome state. This test exercises one variant per state, runs both paths,
 * and asserts the SQL row matches the service result.
 *
 * Cases (one variant per test, both paths run on it):
 *   - OK / NORMAL         - price above every Barem range, desi-based tariff
 *   - OK / BAREM          - Barem destek tier (deliveryDuration = carrier max)
 *   - OK / NORMAL desi-0  - no override, synced desi 0 (a valid tariff tier)
 *   - NO_CARRIER          - TRENDYOL_CONTRACT but no defaultShippingCarrierId
 *   - OWN_CONTRACT_EMPTY  - OWN_CONTRACT but no own_shipping_tariffs rows, once
 *                           with an override desi and once with the synced
 *                           desi-0 default
 *   - DESI_OVERFLOW       - desi exceeds the carrier's tariff coverage
 *   - Barem eligibility   - deliveryDuration 0 (ships today) is eligible; a null
 *                           deliveryDuration and one above the carrier window
 *                           are not
 *   - Dated versions      - both paths read the version in force now, not a
 *                           future one; the SQL switches version exactly at the
 *                           instant the next version starts (Istanbul midnight);
 *                           a carrier with no version in force is DESI_OVERFLOW
 *                           on both paths
 *
 * Each test creates its own org+store+product+variant inline. `truncateAll`
 * between tests wipes tenant data but preserves the global shipping reference
 * tables (shipping_carriers, shipping_desi_tariffs, shipping_barem_tariffs)
 * seeded in PR 1 — see `tests/helpers/db.ts` for the truncate list.
 */

import { prisma } from '@pazarsync/db';
import { Platform } from '@pazarsync/db/enums';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { estimateShippingCostForVariant } from '../../src/services/shipping-estimator.service';
import {
  SHIPPING_ESTIMATE_CTE_SQL,
  type ShippingEstimateRow,
} from '../../src/services/shipping-estimator.sql';
import { ensureDbReachable, truncateAll } from '../helpers/db';
import {
  createTestCarrierWithVersions,
  type TestCarrierTariffVersionSpec,
} from '../helpers/factories';

// ─── Fixture builder ─────────────────────────────────────────────────────────

interface VariantFixtureOptions {
  barcode: string;
  shippingTariffSource?: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
  defaultShippingCarrierId?: string | null;
  salePrice?: string;
  dimensionalWeightOverride?: string | null;
  syncedDimensionalWeight?: string;
  deliveryDuration?: number | null;
}

interface VariantFixture {
  orgId: string;
  storeId: string;
  variantId: string;
}

async function createVariantFixture(opts: VariantFixtureOptions): Promise<VariantFixture> {
  // Unique stamp shielded against same-millisecond fixture creation across
  // tests in this file. The shared DB plus `truncateAll` between tests is
  // already enough, but the random salt makes platformContentId / platformVariantId
  // collisions impossible if the test ordering changes.
  const stamp = Date.now() + Math.floor(Math.random() * 100_000);
  const org = await prisma.organization.create({
    data: { name: 'Equivalence Test Org', slug: `eq-${stamp}-${opts.barcode}` },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Equivalence Test Store',
      platform: 'TRENDYOL',
      externalAccountId: `acct-${stamp}`,
      credentials: 'test-encrypted-blob',
      shippingTariffSource: opts.shippingTariffSource ?? 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: opts.defaultShippingCarrierId ?? null,
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(stamp),
      productMainId: `pm-${stamp}`,
      title: 'Equivalence Test Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(stamp),
      barcode: opts.barcode,
      stockCode: opts.barcode,
      salePrice: opts.salePrice ?? '100.00',
      listPrice: opts.salePrice ?? '100.00',
      dimensionalWeightOverride: opts.dimensionalWeightOverride ?? null,
      // Synced desi NON-NULL, floor 0 (marketplace omits it → stored 0).
      syncedDimensionalWeight: opts.syncedDimensionalWeight ?? '0',
      deliveryDuration: opts.deliveryDuration ?? null,
      attributes: [],
    },
  });
  return { orgId: org.id, storeId: store.id, variantId: variant.id };
}

async function getSendeomp() {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  if (!carrier) {
    throw new Error(
      'SENDEOMP carrier missing — PR 1 (shipping seed) must run before this test file',
    );
  }
  return carrier;
}

async function runBothPaths(fixture: VariantFixture) {
  const fnResult = await prisma.$transaction((tx) =>
    estimateShippingCostForVariant(fixture.variantId, tx),
  );
  const row = await runSqlAt(fixture, new Date().toISOString());
  return { fnResult, row };
}

/** Runs the SQL mirror for the fixture's store with the tariff version in force at `at`. */
async function runSqlAt(fixture: VariantFixture, at: string): Promise<ShippingEstimateRow> {
  const sqlRows = await prisma.$queryRawUnsafe<ShippingEstimateRow[]>(
    SHIPPING_ESTIMATE_CTE_SQL,
    fixture.orgId,
    fixture.storeId,
    at,
  );
  const row = sqlRows.find((r) => r.id === fixture.variantId);
  if (!row) {
    throw new Error(`SQL CTE returned no row for variant ${fixture.variantId}`);
  }
  return row;
}

/** A tariff version with a single desi-1 row, no Barem bands and a 10-desi Barem cap. */
function desiOneVersion(
  effectiveFrom: Date,
  supportsBaremDestek: boolean,
  desi1PriceNet: string,
): TestCarrierTariffVersionSpec {
  return {
    effectiveFrom,
    supportsBaremDestek,
    maxBaremDesi: 10,
    desiRows: [{ desi: 1, priceNet: desi1PriceNet }],
    baremRows: [],
  };
}

async function deleteCarrierByCode(code: string): Promise<void> {
  await prisma.shippingCarrier.deleteMany({ where: { platform: Platform.TRENDYOL, code } });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Equivalence: service fn vs raw SQL CTE', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('OK / NORMAL — fall-through to desi-bazlı tariff (SENDEOMP desi-3 = 101.99)', async () => {
    const carrier = await getSendeomp();
    const fixture = await createVariantFixture({
      barcode: 'eq1',
      defaultShippingCarrierId: carrier.id,
      salePrice: '500.00', // above all Barem ranges → fall through to NORMAL
      dimensionalWeightOverride: '3.0', // CEIL(3.0) = 3 → SENDEOMP desi-3 = 101.99
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OK');
    expect(fnResult.ok).toBe(true);
    if (!fnResult.ok) throw new Error('unreachable: fnResult.ok asserted true above');
    expect(row.shipping_tariff_applied).toBe('NORMAL');
    expect(row.shipping_tariff_applied).toBe(fnResult.estimate.tariffApplied);
    expect(row.shipping_carrier_code).toBe('SENDEOMP');
    expect(row.shipping_carrier_code).toBe(fnResult.estimate.carrierCode);
    expect(row.estimated_shipping_net).toBe(fnResult.estimate.amount.toFixed(2));
    expect(row.estimated_shipping_net).toBe('101.99');
  });

  it('OK / BAREM — Barem destek tier (SENDEOMP [0,200) = 51.24)', async () => {
    const carrier = await getSendeomp();
    const fixture = await createVariantFixture({
      barcode: 'eq2',
      defaultShippingCarrierId: carrier.id,
      salePrice: '150.00', // inside [0, 200) Barem tier
      dimensionalWeightOverride: '2.0', // within carrier.maxBaremDesi=10
      deliveryDuration: 1, // within carrier.maxBaremEligibleDeliveryDuration=1
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OK');
    expect(fnResult.ok).toBe(true);
    if (!fnResult.ok) throw new Error('unreachable: fnResult.ok asserted true above');
    expect(row.shipping_tariff_applied).toBe('BAREM');
    expect(row.shipping_tariff_applied).toBe(fnResult.estimate.tariffApplied);
    expect(row.shipping_carrier_code).toBe('SENDEOMP');
    expect(row.shipping_carrier_code).toBe(fnResult.estimate.carrierCode);
    expect(row.estimated_shipping_net).toBe(fnResult.estimate.amount.toFixed(2));
    expect(row.estimated_shipping_net).toBe('51.24');
  });

  it('OK / NORMAL desi-0 — no override, synced desi defaults to 0', async () => {
    // Desi 0 is a valid tariff tier (marketplace omits desi → stored 0, not
    // null). Both paths resolve the desi-0 row (SENDEOMP desi-0 = 91.99) rather
    // than the retired "no desi → no estimate" outcome.
    const carrier = await getSendeomp();
    const fixture = await createVariantFixture({
      barcode: 'eq3',
      defaultShippingCarrierId: carrier.id,
      dimensionalWeightOverride: null,
      syncedDimensionalWeight: '0',
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OK');
    expect(fnResult.ok).toBe(true);
    if (!fnResult.ok) throw new Error('unreachable: fnResult.ok asserted true above');
    expect(row.shipping_tariff_applied).toBe('NORMAL');
    expect(row.shipping_tariff_applied).toBe(fnResult.estimate.tariffApplied);
    expect(row.shipping_carrier_code).toBe('SENDEOMP');
    expect(row.shipping_carrier_code).toBe(fnResult.estimate.carrierCode);
    expect(row.estimated_shipping_net).toBe(fnResult.estimate.amount.toFixed(2));
    expect(row.estimated_shipping_net).toBe('91.99');
  });

  it('NO_CARRIER — TRENDYOL_CONTRACT store with no defaultShippingCarrierId', async () => {
    const fixture = await createVariantFixture({
      barcode: 'eq4',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: null,
      dimensionalWeightOverride: '1.0',
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('NO_CARRIER');
    expect(fnResult).toEqual({ ok: false, reason: 'NO_CARRIER' });
    expect(row.shipping_tariff_applied).toBeNull();
    expect(row.estimated_shipping_net).toBeNull();
    expect(row.shipping_carrier_code).toBeNull();
  });

  it('OWN_CONTRACT_EMPTY — OWN_CONTRACT store with no own_shipping_tariffs rows (V1 always)', async () => {
    const fixture = await createVariantFixture({
      barcode: 'eq5',
      shippingTariffSource: 'OWN_CONTRACT',
      dimensionalWeightOverride: '1.0',
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OWN_CONTRACT_EMPTY');
    expect(fnResult).toEqual({ ok: false, reason: 'OWN_CONTRACT_EMPTY' });
    expect(row.shipping_tariff_applied).toBeNull();
    expect(row.estimated_shipping_net).toBeNull();
  });

  it('DESI_OVERFLOW — desi exceeds the carrier desi tariff table (SENDEOMP max=12, variant=20)', async () => {
    const carrier = await getSendeomp();
    const fixture = await createVariantFixture({
      barcode: 'eq6',
      defaultShippingCarrierId: carrier.id,
      salePrice: '1500.00',
      dimensionalWeightOverride: '20.0', // CEIL(20) = 20 → no SENDEOMP row (seeded up to 12)
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('DESI_OVERFLOW');
    expect(fnResult).toEqual({ ok: false, reason: 'DESI_OVERFLOW' });
    expect(row.shipping_tariff_applied).toBeNull();
    expect(row.estimated_shipping_net).toBeNull();
    expect(row.shipping_carrier_code).toBe('SENDEOMP');
  });

  // OWN_CONTRACT with the default synced desi (0) and no override: ceil(0) = 0
  // resolves an own_shipping_tariffs lookup that finds nothing (none seeded) →
  // OWN_CONTRACT_EMPTY. Distinct from eq5 (which sets an override desi of 1.0):
  // this pins the synced-0 default path. Service and CTE must agree.
  it('OWN_CONTRACT + desi 0 (default synced) → OWN_CONTRACT_EMPTY', async () => {
    const fixture = await createVariantFixture({
      barcode: 'eq7',
      shippingTariffSource: 'OWN_CONTRACT',
      defaultShippingCarrierId: null,
      dimensionalWeightOverride: null,
      syncedDimensionalWeight: '0',
      salePrice: '100.00',
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OWN_CONTRACT_EMPTY');
    expect(fnResult).toEqual({ ok: false, reason: 'OWN_CONTRACT_EMPTY' });
    expect(row.shipping_tariff_applied).toBeNull();
    expect(row.estimated_shipping_net).toBeNull();
  });

  // Barem eligibility reads deliveryDuration only, on both paths
  // (hasFastDeliverySetup and the CTE Barem predicate). SENDEOMP:
  // maxBaremEligibleDeliveryDuration = 1, Barem [0, 199.99] = 51.24, desi-2
  // normal tariff = 91.99. Same price and desi in the three cases below.
  it('OK / BAREM - deliveryDuration 0 (ships today) is Barem-eligible on both paths', async () => {
    const carrier = await getSendeomp();
    const fixture = await createVariantFixture({
      barcode: 'eq8',
      defaultShippingCarrierId: carrier.id,
      salePrice: '150.00',
      dimensionalWeightOverride: '2.0',
      deliveryDuration: 0,
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OK');
    expect(fnResult.ok).toBe(true);
    if (!fnResult.ok) throw new Error('unreachable: fnResult.ok asserted true above');
    expect(row.shipping_tariff_applied).toBe('BAREM');
    expect(row.shipping_tariff_applied).toBe(fnResult.estimate.tariffApplied);
    expect(row.estimated_shipping_net).toBe(fnResult.estimate.amount.toFixed(2));
    expect(row.estimated_shipping_net).toBe('51.24');
  });

  it('OK / NORMAL - null deliveryDuration is not Barem-eligible on either path', async () => {
    const carrier = await getSendeomp();
    const fixture = await createVariantFixture({
      barcode: 'eq9',
      defaultShippingCarrierId: carrier.id,
      salePrice: '150.00',
      dimensionalWeightOverride: '2.0',
      deliveryDuration: null,
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OK');
    expect(fnResult.ok).toBe(true);
    if (!fnResult.ok) throw new Error('unreachable: fnResult.ok asserted true above');
    expect(row.shipping_tariff_applied).toBe('NORMAL');
    expect(row.shipping_tariff_applied).toBe(fnResult.estimate.tariffApplied);
    expect(row.estimated_shipping_net).toBe(fnResult.estimate.amount.toFixed(2));
    expect(row.estimated_shipping_net).toBe('91.99');
  });

  it('OK / NORMAL - deliveryDuration above the carrier window is not Barem-eligible on either path', async () => {
    const carrier = await getSendeomp();
    const fixture = await createVariantFixture({
      barcode: 'eq10',
      defaultShippingCarrierId: carrier.id,
      salePrice: '150.00',
      dimensionalWeightOverride: '2.0',
      deliveryDuration: 2,
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OK');
    expect(fnResult.ok).toBe(true);
    if (!fnResult.ok) throw new Error('unreachable: fnResult.ok asserted true above');
    expect(row.shipping_tariff_applied).toBe('NORMAL');
    expect(row.shipping_tariff_applied).toBe(fnResult.estimate.tariffApplied);
    expect(row.estimated_shipping_net).toBe(fnResult.estimate.amount.toFixed(2));
    expect(row.estimated_shipping_net).toBe('91.99');
  });
});

// --- Dated tariff versions -------------------------------------------------------
// Both paths read the tariff version of the store's default carrier that is in force
// at the estimate instant. The suite owns three TEST_ carriers (never the seeded
// ones) and deletes them afterwards; their versions and rows cascade.

const FUTURE_CARRIER_CODE = 'TEST_EQ_FUTURE';
const FUTURE_CARRIER_EXTERNAL_ID = 990_302;
const MIDNIGHT_CARRIER_CODE = 'TEST_EQ_MIDNIGHT';
const MIDNIGHT_CARRIER_EXTERNAL_ID = 990_303;
/** Only a 2099 version: no version is in force today. */
const NO_VERSION_CARRIER_CODE = 'TEST_EQ_NO_VERSION';
const NO_VERSION_CARRIER_EXTERNAL_ID = 990_306;

/** The version in force today: open towards the past, like the migrated catalogue. */
const IN_FORCE_START = new Date('2000-01-01T00:00:00.000Z');
const FUTURE_START = new Date('2099-01-01T00:00:00.000Z');
/** 1 December 2026 at 00:00 in Istanbul (UTC+3). */
const ISTANBUL_MIDNIGHT_START = new Date('2026-11-30T21:00:00.000Z');

describe('Equivalence: dated tariff versions', () => {
  let futureCarrierId = '';
  let midnightCarrierId = '';
  let noVersionCarrierId = '';

  beforeAll(async () => {
    await ensureDbReachable();
    // Each carrier's display name is its code. A leftover carrier with the same code
    // is deleted first.
    await deleteCarrierByCode(FUTURE_CARRIER_CODE);
    futureCarrierId = await createTestCarrierWithVersions({
      code: FUTURE_CARRIER_CODE,
      externalId: FUTURE_CARRIER_EXTERNAL_ID,
      versions: [
        desiOneVersion(IN_FORCE_START, true, '100.00'),
        desiOneVersion(FUTURE_START, false, '999.00'),
      ],
    });
    await deleteCarrierByCode(MIDNIGHT_CARRIER_CODE);
    midnightCarrierId = await createTestCarrierWithVersions({
      code: MIDNIGHT_CARRIER_CODE,
      externalId: MIDNIGHT_CARRIER_EXTERNAL_ID,
      versions: [
        desiOneVersion(IN_FORCE_START, true, '100.00'),
        desiOneVersion(ISTANBUL_MIDNIGHT_START, true, '120.00'),
      ],
    });
    await deleteCarrierByCode(NO_VERSION_CARRIER_CODE);
    noVersionCarrierId = await createTestCarrierWithVersions({
      code: NO_VERSION_CARRIER_CODE,
      externalId: NO_VERSION_CARRIER_EXTERNAL_ID,
      versions: [desiOneVersion(FUTURE_START, false, '999.00')],
    });
  });

  afterAll(async () => {
    await deleteCarrierByCode(FUTURE_CARRIER_CODE);
    await deleteCarrierByCode(MIDNIGHT_CARRIER_CODE);
    await deleteCarrierByCode(NO_VERSION_CARRIER_CODE);
  });

  beforeEach(truncateAll);

  it('SQL and TypeScript agree when a future version exists', async () => {
    const fixture = await createVariantFixture({
      barcode: 'eq-future',
      defaultShippingCarrierId: futureCarrierId,
      dimensionalWeightOverride: '1.0',
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OK');
    expect(fnResult.ok).toBe(true);
    if (!fnResult.ok) throw new Error('unreachable: fnResult.ok asserted true above');
    expect(row.shipping_tariff_applied).toBe('NORMAL');
    expect(row.shipping_tariff_applied).toBe(fnResult.estimate.tariffApplied);
    expect(row.shipping_carrier_code).toBe(FUTURE_CARRIER_CODE);
    expect(row.shipping_carrier_code).toBe(fnResult.estimate.carrierCode);
    expect(row.estimated_shipping_net).toBe(fnResult.estimate.amount.toFixed(2));
    expect(row.estimated_shipping_net).toBe('100.00');
  });

  it('the SQL estimate switches version exactly at Istanbul midnight', async () => {
    const fixture = await createVariantFixture({
      barcode: 'eq-midnight',
      defaultShippingCarrierId: midnightCarrierId,
      dimensionalWeightOverride: '1.0',
    });

    const before = await runSqlAt(fixture, '2026-11-30T20:59:59.999Z');
    const atMidnight = await runSqlAt(fixture, '2026-11-30T21:00:00.000Z');

    expect(before.shipping_estimate_status).toBe('OK');
    expect(before.estimated_shipping_net).toBe('100.00');
    expect(atMidnight.shipping_estimate_status).toBe('OK');
    expect(atMidnight.estimated_shipping_net).toBe('120.00');
  });

  // The carrier exists but none of its versions is in force: the SQL's version
  // LATERAL finds nothing, so version_id is NULL and neither the desi nor the Barem
  // lookup resolves. The 2099 version's desi-1 row must not price the variant.
  it('SQL and TypeScript both report DESI_OVERFLOW when no version is in force', async () => {
    const fixture = await createVariantFixture({
      barcode: 'eq-no-version',
      defaultShippingCarrierId: noVersionCarrierId,
      dimensionalWeightOverride: '1.0',
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(fnResult).toEqual({ ok: false, reason: 'DESI_OVERFLOW' });
    expect(row.shipping_estimate_status).toBe('DESI_OVERFLOW');
    expect(row.estimated_shipping_net).toBeNull();
    expect(row.shipping_tariff_applied).toBeNull();
  });
});
