import { randomUUID } from 'node:crypto';

import { prisma, type Prisma } from '@pazarsync/db';
import { type OrderStatus } from '@pazarsync/db/enums';

import { TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE } from '../../../marketplaces/trendyol/settlement-records';

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
  // The carrier name Trendyol writes on the order; matches the melontik carrier's display
  // name so the order resolves to it (the store default is not used on an order).
  cargoProviderName: 'Test Melontik Kargo',
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
       profit_recompute_queue,
       marketplace_finance_records,
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
 * Start of the single tariff version a test carrier gets, matching the migrated
 * catalogue: open towards the past so every order date finds a tariff.
 */
const TEST_TARIFF_VERSION_START = new Date('2000-01-01T00:00:00.000Z');

/**
 * Upserts the carrier's tariff version starting TEST_TARIFF_VERSION_START with the
 * carrier row's Barem attributes, and returns the version id. The carrier keeps its
 * own Barem columns too, because some readers still take them from the carrier.
 */
async function upsertTestTariffVersion(carrier: {
  readonly id: string;
  readonly supportsBaremDestek: boolean;
  readonly maxBaremDesi: number;
  readonly maxBaremEligibleDeliveryDuration: number;
}): Promise<string> {
  const barem = {
    supportsBaremDestek: carrier.supportsBaremDestek,
    maxBaremDesi: carrier.maxBaremDesi,
    maxBaremEligibleDeliveryDuration: carrier.maxBaremEligibleDeliveryDuration,
  };
  const version = await prisma.shippingTariffVersion.upsert({
    where: {
      carrierId_effectiveFrom: { carrierId: carrier.id, effectiveFrom: TEST_TARIFF_VERSION_START },
    },
    create: { carrierId: carrier.id, effectiveFrom: TEST_TARIFF_VERSION_START, ...barem },
    update: barem,
    select: { id: true },
  });
  return version.id;
}

/**
 * Upserts the dedicated melontik carrier (code 'TEST_MELONTIK'), its one tariff
 * version starting 2000-01-01 (same Barem attributes as the carrier) and that
 * version's desi rows '1' and '2' at 81.95 net, no Barem. Idempotent: the shipping
 * tables survive truncation and globalSetup may prune strays, so every run
 * re-ensures it. Returns the carrier id.
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
  const versionId = await upsertTestTariffVersion(carrier);

  for (const desi of [1, 2]) {
    await prisma.shippingDesiTariff.upsert({
      where: { versionId_desi: { versionId, desi } },
      create: {
        carrierId: carrier.id,
        versionId,
        desi,
        priceNet: MELONTIK.desiNet,
        effectiveFrom: new Date('2024-01-01T00:00:00Z'),
      },
      update: { priceNet: MELONTIK.desiNet, effectiveFrom: new Date('2024-01-01T00:00:00Z') },
    });
  }
  return carrier.id;
}

/**
 * Seeds the fee definitions matching the golden fee params (PSF, stoppage, VATs).
 * Fee definitions are global reference data keyed by (platform, feeType,
 * effectiveFrom), so a test that seeds two organizations would re-insert the same
 * rows; `skipDuplicates` makes the repeat a no-op.
 */
export async function seedMelontikFeeDefinitions(): Promise<void> {
  await prisma.feeDefinition.createMany({
    skipDuplicates: true,
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

/** Creates an organization and a Trendyol store on `carrierId`. */
export async function createTrendyolOrg(opts: {
  readonly carrierId: string;
  readonly profitSettings?: Prisma.InputJsonValue;
}): Promise<{ organizationId: string; storeId: string }> {
  const org = await prisma.organization.create({
    data: {
      name: 'Melontik Org',
      slug: `melontik-${randomUUID().slice(0, 8)}`,
    },
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
      vatRate: MELONTIK.costVatRate,
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
      vatRate: MELONTIK.costVatRate,
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
  /** Marks the order as a micro-export (international) sale. */
  readonly isExportSale?: boolean;
  /** Same-day/fast delivery flags, used by the service-fee tier tests. */
  readonly fastDelivery?: boolean;
  readonly fastDeliveryType?: string | null;
  /** Override the stored lineSaleGross to prove the loader ignores it. */
  readonly lineSaleGrossA?: string;
  readonly lineSaleGrossB?: string;
  /**
   * Override item A's stored seller discount. A discount larger than the list gross
   * drives the loader's computed sale (list - discount) negative, so the snapshot
   * assertion rejects the parcel -- a deterministic recompute failure for the queue
   * backoff tests.
   */
  readonly lineSellerDiscountGrossA?: string;
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
      isExportSale: opts.isExportSale ?? false,
      fastDelivery: opts.fastDelivery ?? false,
      fastDeliveryType: opts.fastDeliveryType ?? null,
      usesSellerCargoAgreement: false,
      cargoProviderName: MELONTIK.cargoProviderName,
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
    lineSellerDiscountGrossOverride: opts.lineSellerDiscountGrossA,
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
  readonly lineSellerDiscountGrossOverride?: string;
}): Promise<string> {
  const {
    orderId,
    organizationId,
    variantId,
    item,
    lineSaleGrossOverride,
    lineSellerDiscountGrossOverride,
  } = params;
  const created = await prisma.orderItem.create({
    data: {
      orderId,
      organizationId,
      productVariantId: variantId,
      quantity: 1,
      barcode: item.barcode,
      lineListGross: item.listGross,
      lineSaleGross: lineSaleGrossOverride ?? item.saleGross,
      lineSellerDiscountGross: lineSellerDiscountGrossOverride ?? item.sellerDiscountGross,
      saleVatRate: item.saleVatRate,
      // The golden parcel's commission resolves from the ORDER source: the raw
      // order commission column carries the spec's rate.
      orderCommissionRatePct: item.commissionRate,
    },
  });
  return created.id;
}

/** The columns a raw-finance-record insert accepts; tests set only the ones they need. */
export interface FinanceRecordInput {
  readonly storeId: string;
  readonly organizationId: string;
  readonly family: 'SETTLEMENT' | 'OTHER_FINANCIAL' | 'CARGO_INVOICE_ITEM';
  readonly transactionType: string;
  readonly recordId: string;
  readonly shipmentPackageId?: string | null;
  readonly orderNumber?: string | null;
  readonly barcode?: string | null;
  readonly paymentOrderId?: string | null;
  readonly parcelUniqueId?: string | null;
  readonly invoiceSerial?: string | null;
  readonly debt?: string | null;
  readonly credit?: string | null;
  readonly commissionAmount?: string | null;
  readonly amountGross?: string | null;
  readonly desi?: string | null;
  readonly transactionDate?: Date | null;
}

/** Inserts one raw marketplace_finance_records row, always a TRENDYOL record. */
export async function insertFinanceRecord(input: FinanceRecordInput): Promise<void> {
  await prisma.marketplaceFinanceRecord.create({
    data: {
      organizationId: input.organizationId,
      storeId: input.storeId,
      platform: 'TRENDYOL',
      family: input.family,
      transactionType: input.transactionType,
      recordId: input.recordId,
      shipmentPackageId: input.shipmentPackageId ?? null,
      orderNumber: input.orderNumber ?? null,
      barcode: input.barcode ?? null,
      paymentOrderId: input.paymentOrderId ?? null,
      parcelUniqueId: input.parcelUniqueId ?? null,
      invoiceSerial: input.invoiceSerial ?? null,
      debt: input.debt ?? null,
      credit: input.credit ?? null,
      commissionAmount: input.commissionAmount ?? null,
      amountGross: input.amountGross ?? null,
      desi: input.desi ?? null,
      transactionDate: input.transactionDate ?? null,
      payload: {},
      fetchedAt: new Date(),
    },
  });
}

/**
 * The golden melontik sale-cycle finance records: one sale and one seller discount
 * per item plus the shared payment order, matched to the parcel by shipmentPackageId
 * and paymentOrderId. Mirrors the Phase 2A golden settlement records so the writer
 * reconciles the parcel to the same 191.79 as the pure module does.
 */
export function melontikSaleCycleRecordInputs(parcel: MelontikParcel): FinanceRecordInput[] {
  const base = { storeId: parcel.storeId, organizationId: parcel.organizationId } as const;
  return [
    {
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'sale-a',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.a.barcode,
      credit: '529.00',
      commissionAmount: '100.51',
      paymentOrderId: MELONTIK.paymentOrderId,
    },
    {
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Discount',
      recordId: 'disc-a',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.a.barcode,
      debt: '37.72',
      commissionAmount: '7.17',
    },
    {
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Sale',
      recordId: 'sale-b',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.b.barcode,
      credit: '409.68',
      commissionAmount: '77.84',
      paymentOrderId: MELONTIK.paymentOrderId,
    },
    {
      ...base,
      family: 'SETTLEMENT',
      transactionType: 'Discount',
      recordId: 'disc-b',
      shipmentPackageId: parcel.platformOrderId,
      barcode: MELONTIK.items.b.barcode,
      debt: '29.21',
      commissionAmount: '5.55',
    },
    {
      ...base,
      family: 'OTHER_FINANCIAL',
      transactionType: 'PaymentOrder',
      recordId: 'po-1',
      paymentOrderId: MELONTIK.paymentOrderId,
    },
  ];
}

/** The golden outbound cargo-invoice item, matched to the parcel by parcelUniqueId. */
export function melontikCargoInvoiceInput(
  parcel: MelontikParcel,
  parcelUniqueId: string,
): FinanceRecordInput {
  return {
    storeId: parcel.storeId,
    organizationId: parcel.organizationId,
    family: 'CARGO_INVOICE_ITEM',
    transactionType: TRENDYOL_CARGO_OUTBOUND_ITEM_TYPE,
    recordId: 'cargo-1',
    parcelUniqueId,
    invoiceSerial: 'INV1',
    amountGross: '98.34',
    desi: '2',
  };
}

export interface CarrierTariffSpec {
  readonly code: string;
  readonly externalId: number;
  /** The carrier display name; defaults to the code. The order loader matches the
   * order's cargoProviderName against this, so a test that needs a name distinct from
   * the code (as real carriers have) sets it explicitly. */
  readonly displayName?: string;
  /** The exact cargoProviderName values Trendyol writes on orders for this carrier
   * (the getProviders "Name"). The order loader matches the order's cargoProviderName
   * against these OR the display name. Defaults to [] (backward compatible). */
  readonly orderCargoNames?: readonly string[];
  readonly supportsBaremDestek?: boolean;
  readonly maxBaremDesi?: number;
  readonly desiRows: readonly { desi: number; priceNet: string; effectiveFrom: Date }[];
  readonly baremRows: readonly {
    minOrderAmount: string;
    maxOrderAmount: string;
    priceNet: string;
    effectiveFrom: Date;
  }[];
}

/**
 * Upserts a dedicated carrier (its code should be TEST-prefixed so globalSetup
 * prunes it), its one tariff version starting 2000-01-01 (same Barem attributes as
 * the carrier) and the given desi and Barem rows in that version, each row keeping
 * its explicit effective-from date. Idempotent: the shipping reference tables
 * survive truncation, so every run re-ensures the carrier, its version and its
 * rows. Lets a test exercise the tariff read without mutating the shared melontik
 * carrier. Returns the carrier id.
 */
export async function upsertCarrierWithTariffs(spec: CarrierTariffSpec): Promise<string> {
  const orderCargoNames = spec.orderCargoNames === undefined ? [] : [...spec.orderCargoNames];
  const carrier = await prisma.shippingCarrier.upsert({
    where: { platform_code: { platform: 'TRENDYOL', code: spec.code } },
    create: {
      platform: 'TRENDYOL',
      externalId: spec.externalId,
      code: spec.code,
      displayName: spec.displayName ?? spec.code,
      orderCargoNames,
      supportsBaremDestek: spec.supportsBaremDestek ?? false,
      maxBaremDesi: spec.maxBaremDesi ?? 10,
    },
    update: {
      displayName: spec.displayName ?? spec.code,
      orderCargoNames,
      supportsBaremDestek: spec.supportsBaremDestek ?? false,
      maxBaremDesi: spec.maxBaremDesi ?? 10,
    },
  });
  const versionId = await upsertTestTariffVersion(carrier);
  for (const row of spec.desiRows) {
    await prisma.shippingDesiTariff.upsert({
      where: { versionId_desi: { versionId, desi: row.desi } },
      create: {
        carrierId: carrier.id,
        versionId,
        desi: row.desi,
        priceNet: row.priceNet,
        effectiveFrom: row.effectiveFrom,
      },
      update: { priceNet: row.priceNet, effectiveFrom: row.effectiveFrom },
    });
  }
  for (const row of spec.baremRows) {
    await prisma.shippingBaremTariff.upsert({
      where: {
        versionId_minOrderAmount_maxOrderAmount: {
          versionId,
          minOrderAmount: row.minOrderAmount,
          maxOrderAmount: row.maxOrderAmount,
        },
      },
      create: {
        carrierId: carrier.id,
        versionId,
        minOrderAmount: row.minOrderAmount,
        maxOrderAmount: row.maxOrderAmount,
        priceNet: row.priceNet,
        effectiveFrom: row.effectiveFrom,
      },
      update: { priceNet: row.priceNet, effectiveFrom: row.effectiveFrom },
    });
  }
  return carrier.id;
}

/** Creates one more Trendyol store in an existing org (for store-isolation tests). */
export async function createAdditionalStore(params: {
  readonly organizationId: string;
  readonly name?: string;
}): Promise<string> {
  const store = await prisma.store.create({
    data: {
      organizationId: params.organizationId,
      name: params.name ?? 'Other Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: randomUUID(),
      status: 'ACTIVE',
      credentials: 'x',
      shippingTariffSource: 'TRENDYOL_CONTRACT',
    },
  });
  return store.id;
}

/**
 * Creates a bare order (no items) in an existing org + store with a given order
 * date. Enough for the queue tests, which read the orders table only: the store-
 * and sweep-scope cases need several orders, dated apart, in one store without the
 * full parcel setup.
 */
export async function seedBareOrder(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly orderDate?: Date;
  readonly status?: OrderStatus;
}): Promise<string> {
  const order = await prisma.order.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId,
      platformOrderId: `bare-${randomUUID().slice(0, 8)}`,
      orderDate: params.orderDate ?? MELONTIK.orderDate,
      status: params.status ?? 'DELIVERED',
      isExportSale: false,
      fastDelivery: false,
      fastDeliveryType: null,
      usesSellerCargoAgreement: false,
    },
  });
  return order.id;
}

/**
 * Attaches an extra single-version COGS profile to a variant.
 */
export async function attachCostProfile(params: {
  readonly organizationId: string;
  readonly storeId: string;
  readonly productVariantId: string;
  readonly amountGross: string;
  readonly vatRate: string;
  readonly changedAt?: Date;
  readonly effectiveFrom?: Date;
}): Promise<void> {
  const profile = await prisma.costProfile.create({
    data: {
      organizationId: params.organizationId,
      storeId: params.storeId,
      name: `COGS ${randomUUID().slice(0, 8)}`,
      type: 'COGS',
      amountGross: params.amountGross,
      vatRate: params.vatRate,
    },
  });
  await prisma.costProfileVersion.create({
    data: {
      profileId: profile.id,
      organizationId: params.organizationId,
      version: 1,
      name: profile.name,
      type: 'COGS',
      amountGross: params.amountGross,
      vatRate: params.vatRate,
      changedFields: [],
      changedAt: params.changedAt ?? MELONTIK.costEffectiveFrom,
      effectiveFrom: params.effectiveFrom ?? MELONTIK.costEffectiveFrom,
    },
  });
  await prisma.productVariantCostProfile.create({
    data: {
      organizationId: params.organizationId,
      productVariantId: params.productVariantId,
      profileId: profile.id,
    },
  });
}
