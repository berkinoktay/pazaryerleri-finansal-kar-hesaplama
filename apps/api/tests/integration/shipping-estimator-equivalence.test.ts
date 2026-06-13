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
 * Six states (per spec §5.5):
 *   1. OK / NORMAL              — happy path, normal desi-bazlı tariff
 *   2. OK / BAREM               — happy path, Barem destek tier
 *   3. NO_DESI                  — variant has no desi (neither override nor synced)
 *   4. NO_CARRIER               — TRENDYOL_CONTRACT but no defaultShippingCarrierId
 *   5. OWN_CONTRACT_EMPTY       — OWN_CONTRACT but no own_shipping_tariffs rows
 *   6. DESI_OVERFLOW            — desi exceeds the carrier's tariff coverage
 *
 * Each test creates its own org+store+product+variant inline. `truncateAll`
 * between tests wipes tenant data but preserves the global shipping reference
 * tables (shipping_carriers, shipping_desi_tariffs, shipping_barem_tariffs)
 * seeded in PR 1 — see `tests/helpers/db.ts` for the truncate list.
 */

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { estimateShippingCostForVariant } from '../../src/services/shipping-estimator.service';
import {
  SHIPPING_ESTIMATE_CTE_SQL,
  type ShippingEstimateRow,
} from '../../src/services/shipping-estimator.sql';
import { ensureDbReachable, truncateAll } from '../helpers/db';

// ─── Fixture builder ─────────────────────────────────────────────────────────

interface VariantFixtureOptions {
  barcode: string;
  shippingTariffSource?: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
  defaultShippingCarrierId?: string | null;
  salePrice?: string;
  dimensionalWeight?: string | null;
  syncedDimensionalWeight?: string;
  deliveryDuration?: number | null;
  isRushDelivery?: boolean;
  fastDeliveryOptions?: { deliveryOptionType: string; deliveryDailyCutOffHour: string }[];
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
      dimensionalWeight: opts.dimensionalWeight ?? null,
      // Synced desi NON-NULL, floor 0 (marketplace omits it → stored 0).
      syncedDimensionalWeight: opts.syncedDimensionalWeight ?? '0',
      deliveryDuration: opts.deliveryDuration ?? null,
      isRushDelivery: opts.isRushDelivery ?? false,
      fastDeliveryOptions: opts.fastDeliveryOptions ?? [],
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
  const sqlRows = await prisma.$queryRawUnsafe<ShippingEstimateRow[]>(
    SHIPPING_ESTIMATE_CTE_SQL,
    fixture.orgId,
    fixture.storeId,
  );
  const row = sqlRows.find((r) => r.id === fixture.variantId);
  if (!row) {
    throw new Error(`SQL CTE returned no row for variant ${fixture.variantId}`);
  }
  return { fnResult, row };
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
      dimensionalWeight: '3.0', // CEIL(3.0) = 3 → SENDEOMP desi-3 = 101.99
      isRushDelivery: false,
      fastDeliveryOptions: [],
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
      dimensionalWeight: '2.0', // within carrier.maxBaremDesi=10
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
      dimensionalWeight: null,
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
      dimensionalWeight: '1.0',
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
      dimensionalWeight: '1.0',
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
      dimensionalWeight: '20.0', // CEIL(20) = 20 → no SENDEOMP row (seeded up to 12)
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
      dimensionalWeight: null,
      syncedDimensionalWeight: '0',
      salePrice: '100.00',
    });

    const { fnResult, row } = await runBothPaths(fixture);

    expect(row.shipping_estimate_status).toBe('OWN_CONTRACT_EMPTY');
    expect(fnResult).toEqual({ ok: false, reason: 'OWN_CONTRACT_EMPTY' });
    expect(row.shipping_tariff_applied).toBeNull();
    expect(row.estimated_shipping_net).toBeNull();
  });
});
