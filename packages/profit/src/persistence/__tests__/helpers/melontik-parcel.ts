import { randomUUID } from 'node:crypto';

import { prisma, type Prisma } from '@pazarsync/db';
import { type OrderStatus } from '@pazarsync/db/enums';

/**
 * Shared setup for the profit persistence integration tests (loader + writer).
 * Reproduces the real melontik order 11761487239 of the Phase 2A golden parcel in
 * the isolated test database: an org with TRY accounting, a Trendyol store on a
 * dedicated shipping carrier, matching fee definitions, two variants with TRY COGS
 * profiles, and the two-item order. Records, claims and tariffs are added by the
 * individual tests; this module only builds the deterministic base.
 */

/** Pins the golden melontik numbers so both tests assert against one source. */
export const MELONTIK = {
  orderDate: new Date('2026-10-28T09:00:00Z'),
  businessDate: '2026-10-28',
  carrierCode: 'TEST_MELONTIK',
  carrierExternalId: 990001,
  desiNet: '81.95',
  paymentOrderId: '58450612',
  items: {
    a: {
      barcode: 'bc-a',
      listGross: '529.00',
      sellerDiscountGross: '37.72',
      saleGross: '491.28', // listGross - sellerDiscountGross
      saleVatRate: '10',
      commissionRate: '19',
      costGross: '233.00',
    },
    b: {
      barcode: 'bc-b',
      listGross: '409.68',
      sellerDiscountGross: '29.21',
      saleGross: '380.47',
      saleVatRate: '10',
      commissionRate: '19',
      costGross: '165.00',
    },
  },
  costVatRate: '10',
  costEffectiveFrom: new Date('2026-01-01T00:00:00Z'),
} as const;

export async function ensureDbReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(
      `Cannot reach test database at DATABASE_URL=${process.env['DATABASE_URL']}. ` +
        `Run \`supabase start\` and \`pnpm db:push\` before integration tests. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Truncates every tenant table the persistence tests touch, including the four
 * Phase 3A tables. Shipping reference tables and the micro-export tiers are NOT
 * truncated: they are read-only fixtures seeded once by globalSetup.
 */
export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       profit_line_allocations,
       profit_lines,
       order_profit_statements,
       marketplace_finance_records,
       order_fees,
       order_claim_items,
       order_claims,
       order_items,
       orders,
       product_variant_cost_profiles,
       cost_profile_versions,
       cost_profiles,
       product_variants,
       products,
       commission_tariff_items,
       commission_tariff_periods,
       commission_tariffs,
       own_shipping_tariffs,
       fx_rates,
       marketplace_commission_rate,
       fee_definitions,
       member_store_access,
       stores,
       organization_members,
       organizations,
       user_profiles
     RESTART IDENTITY CASCADE`,
  );
}

/**
 * Upserts the dedicated melontik carrier (code 'TEST_MELONTIK') and its desi
 * tariff rows '1' and '2' at 81.95 net, no Barem. Idempotent: the shipping tables
 * survive truncation and globalSetup may prune strays, so every run re-ensures it.
 */
export async function upsertMelontikCarrier(): Promise<string> {
  const carrier = await prisma.shippingCarrier.upsert({
    where: { platform_code: { platform: 'TRENDYOL', code: MELONTIK.carrierCode } },
    create: {
      platform: 'TRENDYOL',
      externalId: MELONTIK.carrierExternalId,
      code: MELONTIK.carrierCode,
      displayName: 'Test Melontik Kargo',
      supportsBaremDestek: false,
      maxBaremDesi: 10,
    },
    update: { supportsBaremDestek: false, maxBaremDesi: 10 },
  });

  for (const desi of [1, 2]) {
    await prisma.shippingDesiTariff.upsert({
      where: { carrierId_desi: { carrierId: carrier.id, desi } },
      create: {
        carrierId: carrier.id,
        desi,
        priceNet: MELONTIK.desiNet,
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
      update: { priceNet: MELONTIK.desiNet, effectiveFrom: new Date('2024-01-01T00:00:00Z') },
    });
  }
  return carrier.id;
}

/** Seeds the fee definitions matching the golden fee params (PSF, stoppage, VATs). */
export async function seedMelontikFeeDefinitions(): Promise<void> {
  await prisma.feeDefinition.createMany({
    data: [
      {
        platform: 'TRENDYOL',
        feeType: 'PLATFORM_SERVICE',
        displayName: 'Platform Hizmet Bedeli',
        calculationKind: 'FIXED',
        fixedAmountNet: '10.99',
        defaultVatRate: '20.00',
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
      {
        platform: 'TRENDYOL',
        feeType: 'PLATFORM_SERVICE_FAST',
        displayName: 'Platform Hizmet Bedeli (Bugun Kargoda)',
        calculationKind: 'FIXED',
        fixedAmountNet: '6.99',
        defaultVatRate: '20.00',
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
      {
        platform: 'ALL',
        feeType: 'STOPPAGE',
        displayName: 'E-ticaret Stopaji',
        calculationKind: 'RATE_OF_SALE',
        rateOfSale: '0.0100',
        defaultVatRate: '0.00',
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
      {
        platform: 'ALL',
        feeType: 'COMMISSION_INVOICE',
        displayName: 'Komisyon KDV',
        calculationKind: 'FIXED',
        defaultVatRate: '20.00',
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
      {
        platform: 'TRENDYOL',
        feeType: 'SHIPPING',
        displayName: 'Kargo Bedeli',
        calculationKind: 'FORMULA',
        defaultVatRate: '20.00',
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
    ],
  });
}

const DEFAULT_STORE_PROFIT_SETTINGS: Prisma.InputJsonValue = {
  includeStopaj: true,
  includeNegativeNetVat: true,
};

/** Creates an organization (TRY accounting) and a Trendyol store on `carrierId`. */
export async function createTrendyolOrg(opts: {
  readonly carrierId: string;
  readonly profitSettings?: Prisma.InputJsonValue;
}): Promise<{ organizationId: string; storeId: string }> {
  const org = await prisma.organization.create({
    data: { name: 'Melontik Org', slug: `melontik-${randomUUID().slice(0, 8)}`, currency: 'TRY' },
  });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Melontik Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: randomUUID(),
      status: 'ACTIVE',
      credentials: 'test-encrypted-blob',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: opts.carrierId,
      profitSettings: opts.profitSettings ?? DEFAULT_STORE_PROFIT_SETTINGS,
    },
  });
  return { organizationId: org.id, storeId: store.id };
}

/** Creates one product + variant + TRY COGS profile for one melontik item. */
async function createVariantWithCost(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly barcode: string;
  readonly saleGross: string;
  readonly costGross: string;
  readonly platformSuffix: number;
}): Promise<string> {
  const { organizationId, storeId, barcode, saleGross, costGross, platformSuffix } = params;
  const product = await prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(100000 + platformSuffix),
      productMainId: `main-${barcode}`,
      title: `Melontik ${barcode}`,
      categoryId: BigInt(369),
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(200000 + platformSuffix),
      barcode,
      stockCode: `sku-${barcode}`,
      salePrice: saleGross,
      listPrice: saleGross,
      syncedDimensionalWeight: '1',
      isDigital: false,
    },
  });
  const profile = await prisma.costProfile.create({
    data: {
      organizationId,
      storeId,
      name: `COGS ${barcode}`,
      type: 'COGS',
      amountGross: costGross,
      currency: 'TRY',
      vatRate: MELONTIK.costVatRate,
      fxRateMode: 'AUTO',
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId,
      version: 1,
      name: `COGS ${barcode}`,
      type: 'COGS',
      amountGross: costGross,
      currency: 'TRY',
      vatRate: MELONTIK.costVatRate,
      fxRateMode: 'AUTO',
      changedFields: [],
      changedAt: MELONTIK.costEffectiveFrom,
    },
  });
  await prisma.productVariantCostProfile.create({
    data: { organizationId, productVariantId: variant.id, profileId: profile.id },
  });
  return variant.id;
}

export interface SeedMelontikOptions {
  readonly storeProfitSettings?: Prisma.InputJsonValue;
  readonly snapshotIncludeStopaj?: boolean | null;
  readonly snapshotIncludeNegativeNetVat?: boolean | null;
  readonly status?: OrderStatus;
  readonly cargoTrackingNumber?: bigint | null;
  /** Override the stored lineSaleGross to prove the loader ignores it. */
  readonly lineSaleGrossA?: string;
  readonly lineSaleGrossB?: string;
}

export interface MelontikParcel {
  readonly organizationId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly platformOrderId: string;
  readonly itemA: string;
  readonly itemB: string;
  readonly variantA: string;
  readonly variantB: string;
  readonly carrierId: string;
}

/** Builds the full melontik base scenario and returns every id the tests need. */
export async function seedMelontikParcel(opts: SeedMelontikOptions = {}): Promise<MelontikParcel> {
  const carrierId = await upsertMelontikCarrier();
  await seedMelontikFeeDefinitions();
  const { organizationId, storeId } = await createTrendyolOrg({
    carrierId,
    profitSettings: opts.storeProfitSettings,
  });

  const variantA = await createVariantWithCost({
    organizationId,
    storeId,
    barcode: MELONTIK.items.a.barcode,
    saleGross: MELONTIK.items.a.saleGross,
    costGross: MELONTIK.items.a.costGross,
    platformSuffix: 1,
  });
  const variantB = await createVariantWithCost({
    organizationId,
    storeId,
    barcode: MELONTIK.items.b.barcode,
    saleGross: MELONTIK.items.b.saleGross,
    costGross: MELONTIK.items.b.costGross,
    platformSuffix: 2,
  });

  const platformOrderId = `melontik-${randomUUID().slice(0, 8)}`;
  const order = await prisma.order.create({
    data: {
      organizationId,
      storeId,
      platformOrderId,
      orderDate: MELONTIK.orderDate,
      status: opts.status ?? 'DELIVERED',
      micro: false,
      fastDelivery: false,
      usesSellerCargoAgreement: false,
      cargoTrackingNumber: opts.cargoTrackingNumber ?? null,
      snapshotIncludeStopaj: opts.snapshotIncludeStopaj ?? null,
      snapshotIncludeNegativeNetVat: opts.snapshotIncludeNegativeNetVat ?? null,
    },
  });

  const itemA = await createOrderItem({
    orderId: order.id,
    organizationId,
    variantId: variantA,
    item: MELONTIK.items.a,
    lineSaleGrossOverride: opts.lineSaleGrossA,
  });
  const itemB = await createOrderItem({
    orderId: order.id,
    organizationId,
    variantId: variantB,
    item: MELONTIK.items.b,
    lineSaleGrossOverride: opts.lineSaleGrossB,
  });

  return {
    organizationId,
    storeId,
    orderId: order.id,
    platformOrderId,
    itemA,
    itemB,
    variantA,
    variantB,
    carrierId,
  };
}

interface MelontikItemSpec {
  readonly barcode: string;
  readonly listGross: string;
  readonly sellerDiscountGross: string;
  readonly saleGross: string;
  readonly saleVatRate: string;
  readonly commissionRate: string;
  readonly costGross: string;
}

async function createOrderItem(params: {
  readonly orderId: string;
  readonly organizationId: string;
  readonly variantId: string;
  readonly item: MelontikItemSpec;
  readonly lineSaleGrossOverride?: string;
}): Promise<string> {
  const { orderId, organizationId, variantId, item, lineSaleGrossOverride } = params;
  const created = await prisma.orderItem.create({
    data: {
      orderId,
      organizationId,
      productVariantId: variantId,
      quantity: 1,
      barcode: item.barcode,
      lineListGross: item.listGross,
      lineSaleGross: lineSaleGrossOverride ?? item.saleGross,
      lineSellerDiscountGross: item.sellerDiscountGross,
      saleVatRate: item.saleVatRate,
      commissionRate: item.commissionRate,
      commissionGross: '0',
      commissionVatRate: '20',
    },
  });
  return created.id;
}
