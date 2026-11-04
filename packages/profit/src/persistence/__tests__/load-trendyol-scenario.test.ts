/**
 * Integration tests for loadTrendyolScenarioBases (Phase 4B, Gorev 3). They run
 * against the isolated test database and reuse the melontik parcel fixture so the
 * batch scenario loader can be compared, input for input, against what the per-order
 * loader (loadTrendyolParcel) produces for the same product and date.
 *
 * Requires: `supabase start` + `pnpm db:push` before running.
 */

import { Decimal } from 'decimal.js';
import { prisma, type Prisma } from '@pazarsync/db';
import { ProfitIssueCode } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { evaluateTrendyolScenario } from '../../marketplaces/trendyol/scenario';
import { loadTrendyolParcel } from '../load-trendyol-parcel';
import { loadTrendyolScenarioBases } from '../load-trendyol-scenario';
import {
  attachCostProfile,
  createAdditionalStore,
  createTrendyolOrg,
  ensureDbReachable,
  MELONTIK,
  seedMelontikFeeDefinitions,
  seedMelontikParcel,
  truncateAll,
  upsertMelontikCarrier,
} from './helpers/melontik-parcel';

/**
 * Wraps a transaction client so every model-delegate method call (`tx.store.findMany`,
 * `tx.productVariant.findMany`, ...) bumps a counter. The count is the number of
 * logical Prisma operations, i.e. DB round-trips, which is exactly the N+1 metric: it
 * must not grow with the number of variants. `new Proxy` preserves the target's type,
 * so the wrapped client is still a `Prisma.TransactionClient` (no cast).
 */
function countingTransactionClient(
  tx: Prisma.TransactionClient,
  bump: () => void,
): Prisma.TransactionClient {
  return new Proxy(tx, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      const isModelDelegate =
        typeof prop === 'string' &&
        !prop.startsWith('$') &&
        !prop.startsWith('_') &&
        typeof value === 'object' &&
        value !== null;
      if (!isModelDelegate) {
        return value;
      }
      return new Proxy(value, {
        get(delegate, methodName, delegateReceiver) {
          const method: unknown = Reflect.get(delegate, methodName, delegateReceiver);
          if (typeof method !== 'function') {
            return method;
          }
          return (...args: unknown[]): unknown => {
            bump();
            return Reflect.apply(method, delegate, args);
          };
        },
      });
    },
  });
}

/** Creates one priced product + variant (category + barcode + sellable fields) in a store. */
async function createPricedVariant(
  organizationId: string,
  storeId: string,
  index: number,
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(500000 + index),
      productMainId: `scenario-main-${index}`,
      title: `Scenario ${index}`,
      categoryId: BigInt(369),
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(600000 + index),
      barcode: `scenario-bc-${index}`,
      stockCode: `scenario-sku-${index}`,
      salePrice: '150.00',
      listPrice: '150.00',
      vatRate: 20,
      syncedDimensionalWeight: '1',
      isDigital: false,
      deliveryDuration: 1,
    },
  });
  return variant.id;
}

describe('loadTrendyolScenarioBases', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('loads the scenario base of many variants with a constant number of queries', async () => {
    const carrierId = await upsertMelontikCarrier();
    await seedMelontikFeeDefinitions();
    const { organizationId, storeId } = await createTrendyolOrg({ carrierId });

    const variantIds: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      variantIds.push(await createPricedVariant(organizationId, storeId, index));
    }

    async function countQueries(count: number): Promise<number> {
      let queries = 0;
      const counting = countingTransactionClient(prisma, () => {
        queries += 1;
      });
      const bases = await loadTrendyolScenarioBases(counting, {
        organizationId,
        storeId,
        scenarioDate: MELONTIK.orderDate,
        variants: variantIds
          .slice(0, count)
          .map((variantId) => ({ variantId, tariffAnchor: null })),
      });
      expect(bases.size).toBe(count);
      expect([...bases.values()].every((result) => result.kind === 'ready')).toBe(true);
      return queries;
    }

    const countFive = await countQueries(5);
    const countFifty = await countQueries(50);

    expect(countFive).toBeGreaterThan(0);
    // The N+1 guard: the query count for 50 variants equals the count for 5.
    expect(countFifty).toBe(countFive);
  });

  it("matches the order loader's inputs for the same product and date", async () => {
    const parcel = await seedMelontikParcel();

    const order = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA, tariffAnchor: MELONTIK.orderDate }],
    });

    const result = bases.get(parcel.variantA);
    if (result?.kind !== 'ready') {
      throw new Error('expected variant A scenario base to be ready');
    }
    const base = result.base;

    const orderCosts = order.estimateInput.costs.find(
      (entry) => entry.orderItemId === parcel.itemA,
    );
    const orderAttr = order.estimateInput.attributes.items.find(
      (item) => item.orderItemId === parcel.itemA,
    );

    // Cost versions, fee parameters, shipping reference and commission rules are built
    // by the SAME shared sub-loaders, so they match the order's inputs exactly.
    expect(base.costs).toEqual(orderCosts?.profiles);
    expect(base.reference.fees).toEqual(order.estimateInput.reference.fees);
    expect(base.reference.shipping).toEqual(order.estimateInput.reference.shipping);
    expect(base.reference.commission).toEqual(order.estimateInput.reference.commission);

    // Commission chain inputs match too (a scenario never carries an order-line rate,
    // which the order path reads separately).
    expect(base.product.syncedCommissionRatePct).toEqual(orderAttr?.syncedCommissionRatePct);
    expect(base.product.tariffBands).toEqual(orderAttr?.tariffBands ?? null);
    expect(base.product.categoryId).toBe(orderAttr?.categoryId ?? null);
    expect(base.product.brandId).toBe(orderAttr?.brandId ?? null);
  });

  it('surfaces a missing carrier as an estimate issue, not a load failure', async () => {
    const parcel = await seedMelontikParcel();
    // Clear the store's default carrier: TRENDYOL_CONTRACT with no carrier is not a
    // load failure -- the base loads and the shipping gap shows up on evaluation.
    await prisma.store.update({
      where: { id: parcel.storeId },
      data: { defaultShippingCarrierId: null },
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA, tariffAnchor: null }],
    });

    const result = bases.get(parcel.variantA);
    if (result?.kind !== 'ready') {
      throw new Error('expected variant A scenario base to be ready');
    }

    const evaluated = evaluateTrendyolScenario({ ...result.base, unitPrice: new Decimal('100') });
    // Same code + detail the order path produces for a carrier-less TRENDYOL_CONTRACT store.
    expect(evaluated.estimate.issues).toContainEqual({
      code: ProfitIssueCode.SHIPPING_ESTIMATE_UNAVAILABLE,
      orderItemId: null,
      detail: 'NO_CARRIER',
    });
  });

  it("ignores another organization's cost profiles and tariffs", async () => {
    const parcel = await seedMelontikParcel();

    // Another organization + store. Its cost profile is linked to THIS org's variant A
    // (org-denormalized link column) and its commission tariff carries variant A's
    // barcode: the org filter on cost links and the store filter on tariffs must both
    // exclude them.
    const otherOrg = await prisma.organization.create({
      data: { name: 'Rival Org', slug: `rival-${Date.now()}` },
    });
    const otherStoreId = await createAdditionalStore({ organizationId: otherOrg.id });
    await attachCostProfile({
      organizationId: otherOrg.id,
      storeId: otherStoreId,
      productVariantId: parcel.variantA,
      amountGross: '999.00',
      vatRate: '20',
    });

    const rivalTariff = await prisma.commissionTariff.create({
      data: { organizationId: otherOrg.id, storeId: otherStoreId, name: 'Rival tariff' },
    });
    const rivalPeriod = await prisma.commissionTariffPeriod.create({
      data: {
        organizationId: otherOrg.id,
        storeId: otherStoreId,
        tariffId: rivalTariff.id,
        dateRangeLabel: 'covering',
        sortOrder: 0,
        startsAt: new Date('2026-10-01T00:00:00Z'),
        endsAt: new Date('2026-11-30T23:59:00Z'),
      },
    });
    await prisma.commissionTariffItem.create({
      data: {
        organizationId: otherOrg.id,
        storeId: otherStoreId,
        periodId: rivalPeriod.id,
        barcode: MELONTIK.items.a.barcode,
        productTitle: 'Rival melontik',
        currentPrice: MELONTIK.items.a.saleGross,
        currentCommissionPct: '5',
        bands: [{ key: 'band1', commissionPct: '5' }],
      },
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA, tariffAnchor: MELONTIK.orderDate }],
    });

    const result = bases.get(parcel.variantA);
    if (result?.kind !== 'ready') {
      throw new Error('expected variant A scenario base to be ready');
    }
    // Only this org's COGS profile survives; the rival org's cross-org link is filtered out.
    expect(result.base.costs).toHaveLength(1);
    // The rival store's tariff with the same barcode is filtered out by store.
    expect(result.base.product.tariffBands).toBeNull();
  });

  it('drops a cost profile without versions', async () => {
    const parcel = await seedMelontikParcel();

    // A profile with no version row: the cost module throws on a versionless profile,
    // so the loader must drop it before it reaches the engine.
    const emptyProfile = await prisma.costProfile.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        name: 'No versions',
        type: 'PACKAGING',
        amountGross: '50.00',
        vatRate: '20',
      },
    });
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: parcel.organizationId,
        productVariantId: parcel.variantA,
        profileId: emptyProfile.id,
      },
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA, tariffAnchor: null }],
    });

    const result = bases.get(parcel.variantA);
    if (result?.kind !== 'ready') {
      throw new Error('expected variant A scenario base to be ready');
    }
    // Only the seeded COGS profile (which has a version) survives.
    expect(result.base.costs).toHaveLength(1);
    expect(result.base.costs.every((profile) => profile.profileId !== emptyProfile.id)).toBe(true);
    expect(result.base.costs.every((profile) => profile.versions.length > 0)).toBe(true);
  });

  it('takes the tariff bands from the period covering the anchor', async () => {
    const parcel = await seedMelontikParcel();

    const tariff = await prisma.commissionTariff.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        name: 'Melontik tariff',
      },
    });
    const periods: { label: string; startsAt: Date; endsAt: Date | null; pct: string }[] = [
      {
        label: 'before',
        startsAt: new Date('2026-09-01T00:00:00Z'),
        endsAt: new Date('2026-09-30T23:59:00Z'),
        pct: '11',
      },
      {
        label: 'covering',
        startsAt: new Date('2026-10-01T00:00:00Z'),
        endsAt: new Date('2026-11-30T23:59:00Z'),
        pct: '17',
      },
      {
        label: 'open',
        startsAt: new Date('2026-10-01T00:00:00Z'),
        endsAt: null,
        pct: '13',
      },
    ];
    for (const [index, period] of periods.entries()) {
      const createdPeriod = await prisma.commissionTariffPeriod.create({
        data: {
          organizationId: parcel.organizationId,
          storeId: parcel.storeId,
          tariffId: tariff.id,
          dateRangeLabel: period.label,
          sortOrder: index,
          startsAt: period.startsAt,
          endsAt: period.endsAt,
        },
      });
      await prisma.commissionTariffItem.create({
        data: {
          organizationId: parcel.organizationId,
          storeId: parcel.storeId,
          periodId: createdPeriod.id,
          barcode: MELONTIK.items.a.barcode,
          productTitle: `Melontik ${period.label}`,
          currentPrice: MELONTIK.items.a.saleGross,
          currentCommissionPct: period.pct,
          bands: [{ key: 'band1', commissionPct: period.pct }],
        },
      });
    }

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [
        { variantId: parcel.variantA, tariffAnchor: MELONTIK.orderDate },
        { variantId: parcel.variantB, tariffAnchor: null },
      ],
    });

    const variantA = bases.get(parcel.variantA);
    const variantB = bases.get(parcel.variantB);
    if (variantA?.kind !== 'ready' || variantB?.kind !== 'ready') {
      throw new Error('expected both scenario bases to be ready');
    }
    // Variant A resolves at an anchor inside the covering period (17%).
    expect(variantA.base.product.tariffBands).toHaveLength(1);
    expect(variantA.base.product.tariffBands?.[0]?.ratePct.toFixed(0)).toBe('17');
    // A null anchor never resolves bands.
    expect(variantB.base.product.tariffBands).toBeNull();
  });

  it('reports a variant that is not this store as unavailable', async () => {
    const parcel = await seedMelontikParcel();
    const foreignVariantId = '00000000-0000-0000-0000-000000000000';

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [
        { variantId: parcel.variantA, tariffAnchor: null },
        { variantId: foreignVariantId, tariffAnchor: null },
      ],
    });

    expect(bases.get(parcel.variantA)?.kind).toBe('ready');
    expect(bases.get(foreignVariantId)).toEqual({
      kind: 'unavailable',
      reason: 'VARIANT_NOT_FOUND',
    });
  });
});
