/**
 * Integration tests for `estimateShippingCostForVariant`.
 *
 * Real DB — relies on PR 1's seeded shipping_carriers / shipping_desi_tariffs /
 * shipping_barem_tariffs. Each test creates its own org + store + product +
 * variant via inline `prisma.*.create` calls; `truncateAll` between tests
 * wipes tenant data but preserves the global shipping reference tables.
 *
 * Per spec §5.2 + §5.5 (edge cases) and plan Tasks 2.3–2.10. One `it()` per
 * documented branch; SENDEOMP is the witness carrier because its seeded
 * desi-4 row (112.99) and Barem [0,200) row (51.24) anchor the assertions.
 */

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../../tests/helpers/db';
import { estimateShippingCostForVariant } from '../shipping-estimator.service';

// ─── Test-data builders ──────────────────────────────────────────────────────

interface VariantFixtureOptions {
  shippingTariffSource?: 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
  defaultShippingCarrierId?: string | null;
  salePrice?: string;
  dimensionalWeight?: string | null;
  syncedDimensionalWeight?: string;
  deliveryDuration?: number | null;
  isRushDelivery?: boolean;
  fastDeliveryOptions?: string[];
}

/**
 * Create org → store → product → variant in one shot. The platform numeric
 * ids and unique-keys are namespaced via `randomUUID().slice` to avoid
 * cross-test collisions inside the same vitest file run (all tests share one
 * DB and `truncateAll` runs between them, but defensive uniqueness is cheap).
 */
async function createVariantFixture(opts: VariantFixtureOptions = {}) {
  const stamp = Date.now() + Math.floor(Math.random() * 100_000);
  const org = await prisma.organization.create({
    data: { name: 'Test Org', slug: `test-org-${stamp}` },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Test Store',
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
      title: 'Test Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(stamp),
      barcode: `bc-${stamp}`,
      stockCode: `sk-${stamp}`,
      salePrice: opts.salePrice ?? '100.00',
      listPrice: opts.salePrice ?? '100.00',
      dimensionalWeight: opts.dimensionalWeight ?? null,
      // Synced desi is NON-NULL with floor 0 (the marketplace omits it on most
      // products → stored 0, never null). Desi 0 is a valid tariff tier.
      syncedDimensionalWeight: opts.syncedDimensionalWeight ?? '0',
      deliveryDuration: opts.deliveryDuration ?? null,
      isRushDelivery: opts.isRushDelivery ?? false,
      fastDeliveryOptions: opts.fastDeliveryOptions ?? [],
      attributes: [],
    },
  });
  return { org, store, product, variant };
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

async function getCevamp() {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'CEVAMP' } });
  if (!carrier) {
    throw new Error('CEVAMP carrier missing — PR 1 (shipping seed) must run before this test file');
  }
  return carrier;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('estimateShippingCostForVariant', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('returns STORE_NOT_FOUND when the variant does not exist', async () => {
    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant('00000000-0000-0000-0000-000000000000', tx),
    );
    expect(outcome).toEqual({ ok: false, reason: 'STORE_NOT_FOUND' });
  });

  it('returns NO_CARRIER when TRENDYOL_CONTRACT and the store has no defaultShippingCarrierId', async () => {
    const { variant } = await createVariantFixture({
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: null,
      dimensionalWeight: '1.0',
      isRushDelivery: true,
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome).toEqual({ ok: false, reason: 'NO_CARRIER' });
  });

  it('matches the desi-0 tariff when there is no override and synced desi is 0 (the default)', async () => {
    // Desi 0 is a VALID tariff tier — the marketplace omits desi on most
    // products (stored 0, not null), and a 0-desi parcel still resolves the
    // lowest tier (SENDEOMP desi-0 = 91.99). "No desi → no estimate" no longer
    // exists.
    const carrier = await getSendeomp();
    const { variant } = await createVariantFixture({
      defaultShippingCarrierId: carrier.id,
      dimensionalWeight: null,
      syncedDimensionalWeight: '0',
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) expect.fail('Expected outcome.ok to be true');
    expect(outcome.estimate.tariffApplied).toBe('NORMAL');
    expect(outcome.estimate.carrierCode).toBe('SENDEOMP');
    expect(outcome.estimate.amount.toString()).toBe('91.99');
    expect(outcome.estimate.baseDesiAtEstimate.toString()).toBe('0');
  });

  it('returns a NORMAL tariff when salePrice is above every Barem range (fall-through path)', async () => {
    const carrier = await getSendeomp();
    const { variant } = await createVariantFixture({
      defaultShippingCarrierId: carrier.id,
      salePrice: '500.00', // ≥ 350, above all Barem ranges
      dimensionalWeight: '3.5', // ceil → 4 → SENDEOMP desi-4 = 112.99 (seed)
      isRushDelivery: true, // would be Barem-eligible but price falls through
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) expect.fail('Expected outcome.ok to be true');
    expect(outcome.estimate.tariffApplied).toBe('NORMAL');
    expect(outcome.estimate.carrierCode).toBe('SENDEOMP');
    expect(outcome.estimate.amount.toString()).toBe('112.99');
    expect(outcome.estimate.baseDesiAtEstimate.toString()).toBe('3.5');
  });

  it('returns a BAREM tariff when salePrice is inside a tier and the variant is eligible', async () => {
    const carrier = await getSendeomp();
    const { variant } = await createVariantFixture({
      defaultShippingCarrierId: carrier.id,
      salePrice: '150.00', // inside [0, 200) → SENDEOMP Barem = 51.24 (seed)
      dimensionalWeight: '2.0',
      deliveryDuration: 1, // within carrier.maxBaremEligibleDeliveryDuration = 1
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) expect.fail('Expected outcome.ok to be true');
    expect(outcome.estimate.tariffApplied).toBe('BAREM');
    expect(outcome.estimate.carrierCode).toBe('SENDEOMP');
    expect(outcome.estimate.amount.toString()).toBe('51.24');
  });

  it('falls through to NORMAL when the variant is Barem-eligible but salePrice is above every range', async () => {
    const carrier = await getSendeomp();
    const { variant } = await createVariantFixture({
      defaultShippingCarrierId: carrier.id,
      salePrice: '400.00', // ≥ 350, above all Barem ranges
      dimensionalWeight: '2.0', // ceil → 2 → SENDEOMP desi-2 normal tariff
      deliveryDuration: 1, // Barem-eligible
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) expect.fail('Expected outcome.ok to be true');
    expect(outcome.estimate.tariffApplied).toBe('NORMAL');
  });

  it('returns DESI_OVERFLOW when desi exceeds the carrier desi tariff table', async () => {
    const carrier = await getSendeomp(); // SENDEOMP seeded up to desi=12
    const { variant } = await createVariantFixture({
      defaultShippingCarrierId: carrier.id,
      salePrice: '1500.00',
      dimensionalWeight: '20.0',
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome).toEqual({ ok: false, reason: 'DESI_OVERFLOW' });
  });

  it('returns OWN_CONTRACT_EMPTY when shippingTariffSource is OWN_CONTRACT and no own tariff rows exist', async () => {
    const { variant } = await createVariantFixture({
      shippingTariffSource: 'OWN_CONTRACT',
      dimensionalWeight: '1.0',
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome).toEqual({ ok: false, reason: 'OWN_CONTRACT_EMPTY' });
  });

  it('returns OWN_CONTRACT_EMPTY for an OWN_CONTRACT store when desi is 0 and no own_shipping_tariffs row exists', async () => {
    // Desi 0 resolves a tariff lookup (ceil(0) = 0); with no own-contract row
    // seeded for desi 0 the outcome is OWN_CONTRACT_EMPTY, not NO_DESI.
    const { variant } = await createVariantFixture({
      shippingTariffSource: 'OWN_CONTRACT',
      dimensionalWeight: null,
      syncedDimensionalWeight: '0',
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome).toEqual({ ok: false, reason: 'OWN_CONTRACT_EMPTY' });
  });

  it('returns a NORMAL tariff (skipping the Barem path) when the carrier does not support Barem destek', async () => {
    const carrier = await getCevamp(); // supportsBaremDestek = false
    const { variant } = await createVariantFixture({
      defaultShippingCarrierId: carrier.id,
      salePrice: '150.00', // would be inside a Barem tier on a Barem-eligible carrier
      dimensionalWeight: '1.0', // ceil → 1 → CEVAMP desi-1 = 651.74 (seed)
      deliveryDuration: 1, // fast delivery is set up, but carrier still blocks Barem
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) expect.fail('Expected outcome.ok to be true');
    expect(outcome.estimate.tariffApplied).toBe('NORMAL');
    expect(outcome.estimate.carrierCode).toBe('CEVAMP');
    expect(outcome.estimate.amount.toString()).toBe('651.74');
  });

  it('returns a NORMAL tariff when the variant has a Barem-eligible price but no fast-delivery setup', async () => {
    const carrier = await getSendeomp();
    const { variant } = await createVariantFixture({
      defaultShippingCarrierId: carrier.id,
      salePrice: '150.00', // inside [0, 200) Barem range
      dimensionalWeight: '1.0', // ceil → 1, within maxBaremDesi
      deliveryDuration: 5, // above carrier max=1, no fast delivery
      isRushDelivery: false,
      fastDeliveryOptions: [],
    });

    const outcome = await prisma.$transaction((tx) =>
      estimateShippingCostForVariant(variant.id, tx),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) expect.fail('Expected outcome.ok to be true');
    expect(outcome.estimate.tariffApplied).toBe('NORMAL');
    expect(outcome.estimate.carrierCode).toBe('SENDEOMP');
    expect(outcome.estimate.amount.toString()).toBe('91.99');
  });
});
