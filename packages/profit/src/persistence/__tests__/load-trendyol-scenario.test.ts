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
import { Platform, ProfitIssueCode, ProfitLineSource, ProfitLineType } from '@pazarsync/db/enums';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  evaluateTrendyolScenario,
  TRENDYOL_SCENARIO_ITEM_ID,
} from '../../marketplaces/trendyol/scenario';
import {
  FeeDefinitionNotFoundError,
  IncompleteFeeDefinitionError,
} from '../../resolve-fee-definition';
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
  upsertCarrierWithTariffVersions,
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
        variants: variantIds.slice(0, count).map((variantId) => ({ variantId })),
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
    // Give variant A an explicit vat_rate so the scenario has a concrete column to read;
    // the order path takes item A's VAT from the order line (10%), a deliberate source
    // difference the assertions at the end of this test pin.
    const variantVatRatePct = 8;
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { vatRate: variantVatRatePct },
    });

    const order = await loadTrendyolParcel(prisma, {
      organizationId: parcel.organizationId,
      orderId: parcel.orderId,
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA }],
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
    // by the SAME shared sub-loaders, so they match the order's inputs exactly -- apart
    // from the carrier outcome, which only the order resolves (the scenario is a non-order
    // context, so its outcome is null while the order's matched carrier is `matched`).
    expect(base.costs).toEqual(orderCosts?.profiles);
    expect(base.reference.fees).toEqual(order.estimateInput.reference.fees);
    expect(base.reference.shipping.orderCarrierOutcome).toBeNull();
    expect(order.estimateInput.reference.shipping.orderCarrierOutcome).toEqual({ kind: 'matched' });
    expect({ ...base.reference.shipping, orderCarrierOutcome: null }).toEqual({
      ...order.estimateInput.reference.shipping,
      orderCarrierOutcome: null,
    });
    expect(base.reference.commission).toEqual(order.estimateInput.reference.commission);

    // Commission chain inputs match too (a scenario never carries an order-line rate,
    // which the order path reads separately; neither consults tariff bands).
    expect(base.product.syncedCommissionRatePct).toEqual(orderAttr?.syncedCommissionRatePct);
    expect(base.product.categoryId).toBe(orderAttr?.categoryId ?? null);
    expect(base.product.brandId).toBe(orderAttr?.brandId ?? null);

    const orderItemA = order.estimateInput.snapshot.items.find(
      (item) => item.orderItemId === parcel.itemA,
    );
    if (orderItemA === undefined) {
      throw new Error('expected item A in the order parcel snapshot');
    }
    // unitDesi and isDigital share a source (the variant columns), so they match.
    expect(base.product.unitDesi).toEqual(orderItemA.unitDesi);
    expect(base.product.isDigital).toBe(orderItemA.isDigital);
    // saleVatRatePct does not: the scenario reads the variant's own vat_rate column,
    // while the order path reads the order line's saleVatRate (10%) -- so the scenario
    // matches the DB column, not the order's rate.
    expect(base.product.saleVatRatePct).toEqual(new Decimal(variantVatRatePct));
    expect(orderItemA.saleVatRatePct).toEqual(new Decimal(MELONTIK.items.a.saleVatRate));
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
      variants: [{ variantId: parcel.variantA }],
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

  it("ignores another organization's cost profiles", async () => {
    const parcel = await seedMelontikParcel();

    // Another organization + store whose cost profile is linked to THIS org's variant A
    // (org-denormalized link column): the org filter on cost links must exclude it.
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

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA }],
    });

    const result = bases.get(parcel.variantA);
    if (result?.kind !== 'ready') {
      throw new Error('expected variant A scenario base to be ready');
    }
    // Only this org's COGS profile survives; the rival org's cross-org link is filtered out.
    expect(result.base.costs).toHaveLength(1);
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
      variants: [{ variantId: parcel.variantA }],
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

  it('reports an unknown variant id as unavailable', async () => {
    const parcel = await seedMelontikParcel();
    const foreignVariantId = '00000000-0000-0000-0000-000000000000';

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA }, { variantId: foreignVariantId }],
    });

    expect(bases.get(parcel.variantA)?.kind).toBe('ready');
    expect(bases.get(foreignVariantId)).toEqual({
      kind: 'unavailable',
      reason: 'VARIANT_NOT_FOUND',
    });
  });

  it('reports a variant of another store in the same organization as unavailable', async () => {
    const parcel = await seedMelontikParcel();

    // A sibling store in the SAME organization, with a real product + variant that
    // reuses variant A's barcode. A store-blind variant read would match it on the
    // shared barcode; the loader's store filter must keep it out.
    const otherStoreId = await createAdditionalStore({ organizationId: parcel.organizationId });
    const otherProduct = await prisma.product.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: otherStoreId,
        platformContentId: BigInt(700001),
        productMainId: 'other-store-main',
        title: 'Other store melontik',
        categoryId: BigInt(369),
      },
    });
    const otherVariant = await prisma.productVariant.create({
      data: {
        organizationId: parcel.organizationId,
        storeId: otherStoreId,
        productId: otherProduct.id,
        platformVariantId: BigInt(800001),
        barcode: MELONTIK.items.a.barcode, // same barcode as variant A
        stockCode: 'other-store-sku',
        salePrice: '150.00',
        listPrice: '150.00',
        syncedDimensionalWeight: '1',
        isDigital: false,
      },
    });

    // Variant A resolves against the melontik store; the sibling store's variant is not
    // THIS store's, so it is VARIANT_NOT_FOUND despite the shared barcode.
    const both = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA }, { variantId: otherVariant.id }],
    });
    expect(both.get(parcel.variantA)?.kind).toBe('ready');
    expect(both.get(otherVariant.id)).toEqual({
      kind: 'unavailable',
      reason: 'VARIANT_NOT_FOUND',
    });

    // With only the sibling store's variant, the loader finds no variant of this store
    // and takes the early-return branch -- still VARIANT_NOT_FOUND.
    const onlyOther = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: otherVariant.id }],
    });
    expect(onlyOther.get(otherVariant.id)).toEqual({
      kind: 'unavailable',
      reason: 'VARIANT_NOT_FOUND',
    });
  });

  it('prices a digital variant without shipping or a platform service fee', async () => {
    const parcel = await seedMelontikParcel();
    await prisma.productVariant.update({
      where: { id: parcel.variantA },
      data: { isDigital: true },
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId: parcel.organizationId,
      storeId: parcel.storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId: parcel.variantA }],
    });
    const result = bases.get(parcel.variantA);
    if (result?.kind !== 'ready') {
      throw new Error('expected variant A scenario base to be ready');
    }
    expect(result.base.product.isDigital).toBe(true);

    const evaluated = evaluateTrendyolScenario({ ...result.base, unitPrice: new Decimal('100') });
    // An all-digital parcel ships nothing (plan decision 11b) and owes no platform
    // service fee (the PSF digital exemption): neither line is emitted.
    const hasShipping = evaluated.estimate.lines.some(
      (line) => line.type === ProfitLineType.SHIPPING,
    );
    const hasServiceFee = evaluated.estimate.lines.some(
      (line) => line.type === ProfitLineType.SERVICE_FEE,
    );
    expect(hasShipping).toBe(false);
    expect(hasServiceFee).toBe(false);
  });

  it('prices with the cost version effective on the scenario date', async () => {
    const carrierId = await upsertMelontikCarrier();
    await seedMelontikFeeDefinitions();
    const { organizationId, storeId } = await createTrendyolOrg({ carrierId });
    const variantId = await createPricedVariant(organizationId, storeId, 0);

    const profile = await prisma.costProfile.create({
      data: {
        organizationId,
        storeId,
        name: 'Versioned COGS',
        type: 'COGS',
        amountGross: '40.00',
        vatRate: '20',
      },
    });
    // v1 takes effect before the scenario date, v2 after it: the loader must pick v1.
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId,
        version: 1,
        name: 'Versioned COGS',
        type: 'COGS',
        amountGross: '40.00',
        vatRate: '20',
        changedFields: [],
        changedAt: new Date('2026-01-01T00:00:00Z'),
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId,
        version: 2,
        name: 'Versioned COGS',
        type: 'COGS',
        amountGross: '90.00',
        vatRate: '20',
        changedFields: [],
        changedAt: new Date('2027-01-01T00:00:00Z'),
        effectiveFrom: new Date('2027-01-01T00:00:00Z'),
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId, productVariantId: variantId, profileId: profile.id },
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId,
      storeId,
      scenarioDate: MELONTIK.orderDate, // between v1 (2026-01-01) and v2 (2027-01-01)
      variants: [{ variantId }],
    });
    const result = bases.get(variantId);
    if (result?.kind !== 'ready') {
      throw new Error('expected the scenario base to be ready');
    }

    const evaluated = evaluateTrendyolScenario({ ...result.base, unitPrice: new Decimal('100') });
    const costLine = evaluated.estimate.lines.find(
      (line) => line.source === ProfitLineSource.SELLER_INPUT,
    );
    expect(costLine?.amount.gross.toFixed(2)).toBe('40.00');
  });

  it('falls back to the first version when every version starts after the scenario date', async () => {
    const carrierId = await upsertMelontikCarrier();
    await seedMelontikFeeDefinitions();
    const { organizationId, storeId } = await createTrendyolOrg({ carrierId });
    const variantId = await createPricedVariant(organizationId, storeId, 0);

    const profile = await prisma.costProfile.create({
      data: {
        organizationId,
        storeId,
        name: 'Future COGS',
        type: 'COGS',
        amountGross: '70.00',
        vatRate: '20',
      },
    });
    // The only version starts after the scenario date, so the first-version rule
    // (design 6.6) uses it anyway.
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId,
        version: 1,
        name: 'Future COGS',
        type: 'COGS',
        amountGross: '70.00',
        vatRate: '20',
        changedFields: [],
        changedAt: new Date('2027-01-01T00:00:00Z'),
        effectiveFrom: new Date('2027-01-01T00:00:00Z'),
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId, productVariantId: variantId, profileId: profile.id },
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId,
      storeId,
      scenarioDate: MELONTIK.orderDate, // before the only version (2027-01-01)
      variants: [{ variantId }],
    });
    const result = bases.get(variantId);
    if (result?.kind !== 'ready') {
      throw new Error('expected the scenario base to be ready');
    }

    const evaluated = evaluateTrendyolScenario({ ...result.base, unitPrice: new Decimal('100') });
    const costLine = evaluated.estimate.lines.find(
      (line) => line.source === ProfitLineSource.SELLER_INPUT,
    );
    expect(costLine?.amount.gross.toFixed(2)).toBe('70.00');
  });

  it('treats an archived cost version as missing cost', async () => {
    const carrierId = await upsertMelontikCarrier();
    await seedMelontikFeeDefinitions();
    const { organizationId, storeId } = await createTrendyolOrg({ carrierId });
    const variantId = await createPricedVariant(organizationId, storeId, 0);

    const profile = await prisma.costProfile.create({
      data: {
        organizationId,
        storeId,
        name: 'Archived COGS',
        type: 'COGS',
        amountGross: '50.00',
        vatRate: '20',
      },
    });
    // The version chosen at the scenario date is archived, so it contributes nothing
    // and the item ends up with no cost.
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId,
        version: 1,
        name: 'Archived COGS',
        type: 'COGS',
        amountGross: '50.00',
        vatRate: '20',
        changedFields: [],
        changedAt: new Date('2026-01-01T00:00:00Z'),
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        archivedAt: new Date('2026-02-01T00:00:00Z'),
      },
    });
    await prisma.productVariantCostProfile.create({
      data: { organizationId, productVariantId: variantId, profileId: profile.id },
    });

    const bases = await loadTrendyolScenarioBases(prisma, {
      organizationId,
      storeId,
      scenarioDate: MELONTIK.orderDate,
      variants: [{ variantId }],
    });
    const result = bases.get(variantId);
    if (result?.kind !== 'ready') {
      throw new Error('expected the scenario base to be ready');
    }

    const evaluated = evaluateTrendyolScenario({ ...result.base, unitPrice: new Decimal('100') });
    const hasCostLine = evaluated.estimate.lines.some(
      (line) => line.source === ProfitLineSource.SELLER_INPUT,
    );
    expect(hasCostLine).toBe(false);
    expect(evaluated.estimate.issues).toContainEqual({
      code: ProfitIssueCode.MISSING_COST,
      orderItemId: TRENDYOL_SCENARIO_ITEM_ID,
      detail: null,
    });
  });

  it('throws FeeDefinitionNotFoundError when no fee definition covers the scenario date', async () => {
    const parcel = await seedMelontikParcel();

    // The fixture seeds fee definitions from 2024-01-01; a 2023 scenario date is covered
    // by none, so the fee load fails -- no row is deleted.
    await expect(
      loadTrendyolScenarioBases(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        scenarioDate: new Date('2023-06-01T00:00:00Z'),
        variants: [{ variantId: parcel.variantA }],
      }),
    ).rejects.toBeInstanceOf(FeeDefinitionNotFoundError);
  });

  it('throws IncompleteFeeDefinitionError when the platform service definition has no fixed amount', async () => {
    const parcel = await seedMelontikParcel();

    // A later PLATFORM_SERVICE definition with no fixed amount. The unique key is
    // (platform, feeType, effectiveFrom), so a distinct effectiveFrom avoids a clash.
    await prisma.feeDefinition.create({
      data: {
        platform: 'TRENDYOL',
        feeType: 'PLATFORM_SERVICE',
        displayName: 'Platform Hizmet Bedeli (eksik)',
        calculationKind: 'FIXED',
        fixedAmountNet: null,
        defaultVatRate: '20.00',
        effectiveFrom: new Date('2027-01-01T00:00:00Z'),
      },
    });

    let caught: unknown;
    try {
      await loadTrendyolScenarioBases(prisma, {
        organizationId: parcel.organizationId,
        storeId: parcel.storeId,
        scenarioDate: new Date('2027-06-01T00:00:00Z'),
        variants: [{ variantId: parcel.variantA }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IncompleteFeeDefinitionError);
    if (!(caught instanceof IncompleteFeeDefinitionError)) {
      throw new Error('expected an IncompleteFeeDefinitionError');
    }
    expect(caught.feeType).toBe('PLATFORM_SERVICE');
    expect(caught.field).toBe('fixedAmountNet');
  });

  it('scenario Barem eligibility follows the duration of the version in force', async () => {
    // A dedicated carrier with two Barem versions: v1 allows a 1-day delivery window,
    // v2 (from 1 December 2026, 00:00 Istanbul) a 3-day one, so the 2-day variant is
    // eligible only from v2's start.
    const carrierCode = 'TEST_SCENARIO_BAREM_WINDOW';
    const v1Start = new Date('2000-01-01T00:00:00.000Z');
    const v2Start = new Date('2026-11-30T21:00:00.000Z');
    const deleteCarrier = async (): Promise<void> => {
      // Versions, desi and Barem rows cascade; the store's default carrier is set null.
      await prisma.shippingCarrier.deleteMany({
        where: { platform: Platform.TRENDYOL, code: carrierCode },
      });
    };
    await deleteCarrier();

    try {
      const carrierId = await upsertCarrierWithTariffVersions({
        code: carrierCode,
        externalId: 990_102,
        displayName: 'Test Scenario Barem Window',
        versions: [
          {
            effectiveFrom: v1Start,
            supportsBaremDestek: true,
            maxBaremDesi: 10,
            maxBaremEligibleDeliveryDuration: 1,
            desiRows: [{ desi: 1, priceNet: '80.00' }],
            baremRows: [{ minOrderAmount: '0.00', maxOrderAmount: '199.99', priceNet: '40.00' }],
          },
          {
            effectiveFrom: v2Start,
            supportsBaremDestek: true,
            maxBaremDesi: 10,
            maxBaremEligibleDeliveryDuration: 3,
            desiRows: [{ desi: 1, priceNet: '90.00' }],
            baremRows: [{ minOrderAmount: '0.00', maxOrderAmount: '199.99', priceNet: '45.00' }],
          },
        ],
      });

      await seedMelontikFeeDefinitions();
      const { organizationId, storeId } = await createTrendyolOrg({ carrierId });
      const variantId = await createPricedVariant(organizationId, storeId, 0);
      await prisma.productVariant.update({
        where: { id: variantId },
        data: { deliveryDuration: 2 },
      });

      async function fastDeliveryAt(scenarioDate: Date): Promise<boolean> {
        const bases = await loadTrendyolScenarioBases(prisma, {
          organizationId,
          storeId,
          scenarioDate,
          variants: [{ variantId }],
        });
        const result = bases.get(variantId);
        if (result?.kind !== 'ready') {
          throw new Error('expected the scenario base to be ready');
        }
        return result.base.fastDelivery;
      }

      expect(await fastDeliveryAt(new Date('2026-11-30T20:59:59.999Z'))).toBe(false);
      expect(await fastDeliveryAt(new Date('2026-11-30T21:00:00.000Z'))).toBe(true);
    } finally {
      await deleteCarrier();
    }
  });
});
