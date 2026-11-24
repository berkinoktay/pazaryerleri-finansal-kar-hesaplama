import { randomUUID } from 'node:crypto';

import type {
  BaremTier,
  BufferEntryStatus,
  CostProfileType,
  FeeCalculationKind,
  FinanceRecordFamily,
  MemberRole,
  OrderFeeType,
  OrderStatus,
  Platform,
  Prisma,
  ProfitLineCertainty,
  ProfitLineLevel,
  ProfitLineSource,
  ProfitLineType,
  ProfitStatementView,
  ProfitStatus,
  ReconciliationStatus,
  StoreEnvironment,
  StoreStatus,
} from '@pazarsync/db';
import { PROFIT_ENGINE_VERSION } from '@pazarsync/profit';
import { getBusinessDateAnchor } from '@pazarsync/utils';

import { prisma } from './db';

// Re-exported so test files can write `import type { MemberRole } from
// '../helpers/factories'` without reaching into @pazarsync/db directly —
// the helpers module is the canonical seam for tests, and this avoids
// every test file growing a second package import.
export type { FeeCalculationKind, MemberRole, OrderFeeType } from '@pazarsync/db';

export interface CreateUserProfileOverrides {
  id?: string;
  email?: string;
  fullName?: string | null;
}

export async function createUserProfile(overrides: CreateUserProfileOverrides = {}) {
  const id = overrides.id ?? randomUUID();
  return prisma.userProfile.create({
    data: {
      id,
      email: overrides.email ?? `${id}@test.local`,
      fullName: overrides.fullName ?? 'Test User',
    },
  });
}

export interface CreateOrganizationOverrides {
  name?: string;
  slug?: string;
}

export async function createOrganization(overrides: CreateOrganizationOverrides = {}) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      name: overrides.name ?? 'Test Organization',
      slug: overrides.slug ?? `test-org-${id.slice(0, 8)}`,
    },
  });
}

export async function createMembership(
  organizationId: string,
  userId: string,
  role: MemberRole = 'OWNER',
) {
  return prisma.organizationMember.create({
    data: { organizationId, userId, role },
  });
}

export interface CreateStoreOverrides {
  name?: string;
  platform?: Platform;
  environment?: StoreEnvironment;
  externalAccountId?: string;
  status?: StoreStatus;
  // Per-store profit-formula toggles (JSONB). Omit for the default '{}' (resolves to
  // includeStopaj=true, includeNegativeNetVat=false).
  profitSettings?: { includeStopaj?: boolean; includeNegativeNetVat?: boolean };
}

export async function createStore(organizationId: string, overrides: CreateStoreOverrides = {}) {
  return prisma.store.create({
    data: {
      organizationId,
      name: overrides.name ?? 'Test Store',
      platform: overrides.platform ?? 'TRENDYOL',
      environment: overrides.environment ?? 'PRODUCTION',
      // Default is a fresh UUID per call so the composite unique
      // (organizationId, platform, externalAccountId) constraint does
      // not trip when a fixture creates multiple stores under one org.
      externalAccountId: overrides.externalAccountId ?? randomUUID(),
      status: overrides.status ?? 'ACTIVE',
      // Opaque placeholder; tests that need a real encrypted value
      // call encryptCredentials themselves.
      credentials: 'test-encrypted-blob',
      ...(overrides.profitSettings === undefined
        ? {}
        : { profitSettings: overrides.profitSettings }),
    },
  });
}

/**
 * Grant a MEMBER/VIEWER access to a specific store. `memberId` is the
 * OrganizationMember.id (returned by `createMembership`), not the user id.
 * OWNER/ADMIN see all stores by role and never need these rows.
 */
export async function createMemberStoreAccess(
  organizationId: string,
  memberId: string,
  storeId: string,
  grantedBy: string | null = null,
) {
  return prisma.memberStoreAccess.create({
    data: { organizationId, memberId, storeId, grantedBy },
  });
}

export interface CreateOrderOverrides {
  status?: OrderStatus;
  // GROSS CONVENTION (2026-06-16, Bölüm E Task 20): saleGross + saleVat (KDV-dahil).
  // Eski saleSubtotalNet / saleVatTotal kolonları kaldırıldı; saleGross/saleVat yazılır.
  // Net türetilir downstream: saleGross × 100/(100+vatRate).
  // KPI/chart/orders aggregate'leri bu kolonlardan okuyor. Decimal kolonları string
  // alır (Prisma coerce eder); null = "henüz hesaplanmadı".
  orderDate?: Date;
  platformOrderId?: string;
  platformOrderNumber?: string | null;
  saleGross?: string | null;
  saleVat?: string | null;
  // Promosyon adları + brüt tutarları (spec ekleme #3). Order upsert'in yazdığı
  // JSON; liste/detay/canlı-performans bu kolondan servis eder. null = indirimsiz.
  promotionDisplays?: { displayName: string; amountGross: string }[] | null;
  // Buffer-graduation marker: non-null when the order came from the
  // live-performance buffer (drives the notification summary's isPromotion flag).
  promotedFromBufferAt?: Date | null;
  // Export (cross-border) sale flag; Trendyol micro export orders.
  isExportSale?: boolean;
  // Seller-input marker: null (default) = the order's cost links and desi still
  // follow its business day; a date = the day-close pass made them final.
  sellerInputsFinalAt?: Date | null;
}

export async function createOrder(
  organizationId: string,
  storeId: string,
  overrides: CreateOrderOverrides = {},
) {
  return prisma.order.create({
    data: {
      organizationId,
      storeId,
      platformOrderId: overrides.platformOrderId ?? `test-order-${randomUUID().slice(0, 8)}`,
      platformOrderNumber: overrides.platformOrderNumber ?? null,
      orderDate: overrides.orderDate ?? new Date(),
      status: overrides.status ?? 'DELIVERED',
      saleGross: overrides.saleGross ?? null,
      saleVat: overrides.saleVat ?? null,
      // Omit (undefined) → column stays SQL NULL, matching the order upsert's
      // no-promotion write. A provided array is stored verbatim as JSON.
      promotionDisplays: overrides.promotionDisplays ?? undefined,
      promotedFromBufferAt: overrides.promotedFromBufferAt ?? null,
      isExportSale: overrides.isExportSale ?? false,
      sellerInputsFinalAt: overrides.sellerInputsFinalAt ?? null,
    },
  });
}

export interface CreateOrderItemOverrides {
  quantity?: number;
  // GROSS CONVENTION (2026-06-16): lineSaleGross replaces unitPrice.
  lineSaleGross?: string;
  productVariantId?: string | null;
}

/**
 * One order line. `quantity` feeds "units sold". Money columns default to zero;
 * commission and cost figures live on profit lines (`createProfitLine`), not on
 * the item.
 */
export async function createOrderItem(
  orderId: string,
  organizationId: string,
  overrides: CreateOrderItemOverrides = {},
) {
  return prisma.orderItem.create({
    data: {
      orderId,
      organizationId,
      quantity: overrides.quantity ?? 1,
      lineSaleGross: overrides.lineSaleGross ?? '0.00',
      productVariantId: overrides.productVariantId ?? null,
    },
  });
}

// ─── Profit Calculation V1 (PR-1) ──────────────────────────────────────
// Minimal factory'ler — RLS tests sadece tenant izolasyon doğrular, business
// data doğru olmak zorunda değil. Override interface'i ileride iş mantığı
// test'leri (PR-6+) için genişletilebilir.

export async function createFeeDefinition(
  overrides: {
    platform?: Platform;
    feeType?: OrderFeeType;
    displayName?: string;
    calculationKind?: FeeCalculationKind;
    fixedAmountNet?: string;
    rateOfSale?: string;
    defaultVatRate?: string;
    effectiveFrom?: Date;
    isRequired?: boolean;
  } = {},
) {
  return prisma.feeDefinition.create({
    data: {
      platform: overrides.platform ?? 'TRENDYOL',
      feeType: overrides.feeType ?? 'PLATFORM_SERVICE',
      displayName: overrides.displayName ?? 'Test Fee',
      calculationKind: overrides.calculationKind ?? 'FIXED',
      fixedAmountNet: overrides.fixedAmountNet ?? '10.99',
      rateOfSale: overrides.rateOfSale ?? null,
      defaultVatRate: overrides.defaultVatRate ?? '20.00',
      effectiveFrom: overrides.effectiveFrom ?? new Date('2026-01-01'),
      isRequired: overrides.isRequired ?? false,
    },
  });
}

export async function createOrderClaim(
  organizationId: string,
  storeId: string,
  orderId: string,
  overrides: {
    marketplaceClaimId?: string;
    claimDate?: Date;
    resolved?: boolean;
    orderShipmentPackageId?: string | null;
  } = {},
) {
  return prisma.orderClaim.create({
    data: {
      organizationId,
      storeId,
      orderId,
      marketplaceClaimId: overrides.marketplaceClaimId ?? `claim-${randomUUID().slice(0, 8)}`,
      claimDate: overrides.claimDate ?? new Date(),
      resolved: overrides.resolved ?? false,
      orderShipmentPackageId: overrides.orderShipmentPackageId ?? null,
    },
  });
}

export async function createOrderClaimItem(
  claimId: string,
  overrides: {
    orderItemId?: string | null;
    marketplaceClaimItemId?: string;
    reasonCode?: string;
    reasonName?: string;
    status?: string;
    acceptedBySeller?: boolean;
    resolved?: boolean;
  } = {},
) {
  return prisma.orderClaimItem.create({
    data: {
      claimId,
      orderItemId: overrides.orderItemId ?? null,
      marketplaceClaimItemId:
        overrides.marketplaceClaimItemId ?? `claim-item-${randomUUID().slice(0, 8)}`,
      reasonCode: overrides.reasonCode ?? 'DAMAGEDITEM',
      reasonName: overrides.reasonName ?? 'Hasarlı Ürün',
      status: overrides.status ?? 'Pending',
      acceptedBySeller: overrides.acceptedBySeller ?? false,
      resolved: overrides.resolved ?? false,
    },
  });
}

// ─── Trendyol webhook (PR-C1) ──────────────────────────────────────────

export async function createWebhookEvent(
  organizationId: string,
  storeId: string,
  overrides: {
    platform?: Platform;
    platformOrderId?: string;
    platformStatus?: string;
    platformLastModifiedDate?: Date;
    processedAt?: Date | null;
    processingError?: string | null;
    rawPayload?: Record<string, unknown>;
  } = {},
) {
  return prisma.webhookEvent.create({
    data: {
      organizationId,
      storeId,
      platform: overrides.platform ?? 'TRENDYOL',
      platformOrderId: overrides.platformOrderId ?? `pkg-${randomUUID().slice(0, 10)}`,
      platformStatus: overrides.platformStatus ?? 'Delivered',
      platformLastModifiedDate:
        overrides.platformLastModifiedDate ?? new Date('2026-05-20T10:00:00Z'),
      processedAt: overrides.processedAt ?? null,
      processingError: overrides.processingError ?? null,
      rawPayload: (overrides.rawPayload ?? { shipmentPackageId: 12345 }) as Prisma.JsonObject,
    },
  });
}

// ─── Cost profile (calculability gate PR-B) ────────────────────────────

/**
 * Far-past default for a fixture cost's version `effectiveFrom`, so the cost is in
 * force for any test order unless a test opts into a later instant (plan PR-3b).
 */
export const COST_FIXTURE_EPOCH = new Date('2000-01-01T00:00:00Z');

export async function createCostProfile(
  organizationId: string,
  overrides: {
    storeId?: string;
    name?: string;
    type?: CostProfileType;
    amountGross?: string;
    /** false = create the profile row only; the test writes its own versions. */
    seedVersion?: false;
  } = {},
) {
  // GROSS konvansiyon (2026-06-16): amountGross is GROSS (KDV-dahil) + vatRate.
  // A cost snapshot captured from this profile is fully specified (gross + rate),
  // which is what the profit engine needs to compute a non-null net profit.
  //
  // storeId is required on the model (cost profiles are store-scoped). Tests that
  // attach a profile to a variant MUST pass the variant's storeId so both share a
  // store (the attach guard rejects a cross-store attach); tests that don't care
  // get a throwaway store auto-created here.
  //
  // Like the cost-profile service, the profile is created with its version 1 (same
  // amount and rate, not archived, effective from COST_FIXTURE_EPOCH): the cost rule
  // counts a profile only through a version in force (plan PR-3b).
  const storeId = overrides.storeId ?? (await createStore(organizationId)).id;
  const profile = await prisma.costProfile.create({
    data: {
      organizationId,
      storeId,
      name: overrides.name ?? `COGS-${randomUUID().slice(0, 8)}`,
      type: overrides.type ?? 'COGS',
      amountGross: overrides.amountGross ?? '60.00',
      vatRate: 20,
    },
  });
  if (overrides.seedVersion !== false) {
    await prisma.costProfileVersion.create({
      data: {
        profileId: profile.id,
        organizationId,
        version: 1,
        name: profile.name,
        type: profile.type,
        amountGross: profile.amountGross,
        vatRate: profile.vatRate,
        changedFields: [],
        changedAt: COST_FIXTURE_EPOCH,
        effectiveFrom: COST_FIXTURE_EPOCH,
      },
    });
  }
  return profile;
}

export async function createBufferEntry(
  organizationId: string,
  storeId: string,
  overrides: {
    orderDate?: Date;
    platformOrderId?: string;
    platformOrderNumber?: string;
    status?: BufferEntryStatus;
    rawPayload?: Prisma.InputJsonValue;
    mappedOrder?: Prisma.InputJsonValue;
  } = {},
) {
  return prisma.livePerformanceBuffer.create({
    data: {
      organizationId,
      storeId,
      // order_date is a DATE holding the business (Istanbul) day. A raw `new Date()` would
      // store the UTC day, which is the previous day between 00:00 and 03:00 Istanbul time.
      orderDate: overrides.orderDate ?? getBusinessDateAnchor(),
      platformOrderId: overrides.platformOrderId ?? `pkg-${randomUUID().slice(0, 8)}`,
      platformOrderNumber: overrides.platformOrderNumber ?? `ord-${randomUUID().slice(0, 8)}`,
      rawPayload: overrides.rawPayload ?? { test: true },
      mappedOrder: overrides.mappedOrder ?? { lines: [] },
      status: overrides.status ?? 'PENDING',
    },
  });
}

// ─── Fiyat Yazma Denetim Kaydı (trendyol-price-write) ─────────────────

export async function createProduct(
  organizationId: string,
  storeId: string,
  overrides: { platformContentId?: bigint; productMainId?: string; title?: string } = {},
) {
  return prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: overrides.platformContentId ?? BigInt(Math.floor(Math.random() * 1e9)),
      productMainId: overrides.productMainId ?? `pm-${randomUUID().slice(0, 8)}`,
      title: overrides.title ?? 'Test Product',
    },
  });
}

export async function createProductVariant(
  organizationId: string,
  storeId: string,
  productId: string,
  overrides: {
    barcode?: string;
    salePrice?: string;
    listPrice?: string;
    platformVariantId?: bigint;
  } = {},
) {
  return prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId,
      platformVariantId: overrides.platformVariantId ?? BigInt(Math.floor(Math.random() * 1e12)),
      barcode: overrides.barcode ?? `BC-${randomUUID().slice(0, 10)}`,
      stockCode: `SC-${randomUUID().slice(0, 8)}`,
      salePrice: overrides.salePrice ?? '100.00',
      listPrice: overrides.listPrice ?? '120.00',
    },
  });
}

/**
 * A second catalog variant carrying `barcode`, with the same economics as the source:
 * same organization, store and product, every scalar of the source copied (prices, VAT,
 * desi, isDigital, synced commission rate, listing status, ...) except its id, barcode,
 * platformVariantId (random, as `createProductVariant` does) and timestamps; stockCode is
 * the new barcode. Every cost-profile link of the source is copied to the clone, with its
 * `attachedAt` (the cost rule judges a link by it, plan PR-3b). Gives a
 * campaign item's own barcode a catalog variant priced exactly like an existing fixture
 * variant (campaign reads resolve the variant from the item's barcode).
 */
export async function cloneVariantWithBarcode(variantId: string, barcode: string) {
  const source = await prisma.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    include: {
      costProfileLinks: { select: { organizationId: true, profileId: true, attachedAt: true } },
    },
  });
  const {
    id: _id,
    barcode: _barcode,
    platformVariantId: _platformVariantId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    costProfileLinks,
    attributes,
    ...scalars
  } = source;
  return prisma.productVariant.create({
    data: {
      ...scalars,
      // A create cannot take a bare null for this NOT NULL column: a JSON null read back
      // falls to the column's '[]' default.
      attributes: attributes ?? [],
      barcode,
      stockCode: barcode,
      platformVariantId: BigInt(Math.floor(Math.random() * 1e12)),
      costProfileLinks: {
        create: costProfileLinks.map((link) => ({
          organizationId: link.organizationId,
          profileId: link.profileId,
          attachedAt: link.attachedAt,
        })),
      },
    },
  });
}

export async function createPriceChangeLog(
  organizationId: string,
  storeId: string,
  variantId: string,
  userId: string,
  overrides: {
    barcode?: string;
    oldSalePrice?: string;
    newSalePrice?: string;
    listPrice?: string | null;
    trendyolBatchId?: string | null;
    status?: 'PENDING' | 'SUCCESS' | 'FAILED';
    errorCode?: string | null;
  } = {},
) {
  return prisma.priceChangeLog.create({
    data: {
      organizationId,
      storeId,
      variantId,
      userId,
      platform: 'TRENDYOL',
      barcode: overrides.barcode ?? `BC-${randomUUID().slice(0, 10)}`,
      oldSalePrice: overrides.oldSalePrice ?? '100.00',
      newSalePrice: overrides.newSalePrice ?? '120.00',
      listPrice: overrides.listPrice ?? null,
      trendyolBatchId: overrides.trendyolBatchId ?? `batch-${randomUUID()}`,
      status: overrides.status ?? 'PENDING',
      errorCode: overrides.errorCode ?? null,
    },
  });
}

// ─── Profit engine statements & lines (rebuild, phase 4A) ──────────────
// Both tables are written only by the profit writer in production; tests seed
// them directly so the order read paths (list, summary, detail, live
// performance, returns) can be exercised without running the engine.

export interface CreateProfitStatementOverrides {
  view?: ProfitStatementView;
  status?: ProfitStatus;
  reconciliationStatus?: ReconciliationStatus;
  // Decimal columns take strings (Prisma coerces). Totals default to "0".
  saleGross?: string;
  costGross?: string;
  vatOutput?: string;
  vatInput?: string;
  vatNet?: string;
  vatEffective?: string;
  stoppageGross?: string;
  stoppageIncluded?: boolean;
  // netProfit + margins are nullable: null = not computable / excluded.
  netProfit?: string | null;
  saleMarginPct?: string | null;
  costMarkupPct?: string | null;
  issues?: Prisma.InputJsonValue;
  settingsSnapshot?: Prisma.InputJsonValue;
  contentHash?: string;
  computedAt?: Date;
}

/**
 * One computed profit statement for a parcel. Defaults to a best-known,
 * estimated-status view with zero totals and null net profit / margins; pass a
 * view/status/amounts override to shape the two views a test needs.
 */
export async function createProfitStatement(
  orderId: string,
  organizationId: string,
  storeId: string,
  overrides: CreateProfitStatementOverrides = {},
) {
  return prisma.orderProfitStatement.create({
    data: {
      organizationId,
      storeId,
      orderId,
      view: overrides.view ?? 'BEST_KNOWN',
      status: overrides.status ?? 'ESTIMATED',
      reconciliationStatus: overrides.reconciliationStatus ?? 'NOT_SETTLED',
      saleGross: overrides.saleGross ?? '0',
      costGross: overrides.costGross ?? '0',
      vatOutput: overrides.vatOutput ?? '0',
      vatInput: overrides.vatInput ?? '0',
      vatNet: overrides.vatNet ?? '0',
      vatEffective: overrides.vatEffective ?? '0',
      stoppageGross: overrides.stoppageGross ?? '0',
      stoppageIncluded: overrides.stoppageIncluded ?? false,
      netProfit: overrides.netProfit ?? null,
      saleMarginPct: overrides.saleMarginPct ?? null,
      costMarkupPct: overrides.costMarkupPct ?? null,
      issues: overrides.issues ?? [],
      settingsSnapshot: overrides.settingsSnapshot ?? {},
      engineVersion: PROFIT_ENGINE_VERSION,
      contentHash: overrides.contentHash ?? 'test',
      computedAt: overrides.computedAt ?? new Date(),
    },
  });
}

export interface CreateFinanceRecordOverrides {
  platform?: Platform;
  family?: FinanceRecordFamily;
  transactionType?: string;
  recordId?: string;
  // Nullable on the model; pass a date to place the row in or out of a
  // transaction-date window. Explicit null keeps the column NULL.
  transactionDate?: Date | null;
  payload?: Prisma.InputJsonValue;
  fetchedAt?: Date;
}

/**
 * One raw marketplace finance record. Defaults to a SETTLEMENT-family Trendyol
 * row dated now with an empty payload. The returns summary joins a profit
 * line's externalRecordId to this row's recordId, so a test links the two by
 * passing the same recordId and dates the money with transactionDate.
 */
export async function createFinanceRecord(
  organizationId: string,
  storeId: string,
  overrides: CreateFinanceRecordOverrides = {},
) {
  return prisma.marketplaceFinanceRecord.create({
    data: {
      organizationId,
      storeId,
      platform: overrides.platform ?? 'TRENDYOL',
      family: overrides.family ?? 'SETTLEMENT',
      transactionType: overrides.transactionType ?? 'Return',
      recordId: overrides.recordId ?? `rec-${randomUUID().slice(0, 8)}`,
      transactionDate:
        overrides.transactionDate === undefined ? new Date() : overrides.transactionDate,
      payload: overrides.payload ?? {},
      fetchedAt: overrides.fetchedAt ?? new Date(),
    },
  });
}

export interface CreateProfitLineOverrides {
  // Required for an item-level line; null for a parcel-level line.
  orderItemId?: string | null;
  type?: ProfitLineType;
  level?: ProfitLineLevel;
  certainty?: ProfitLineCertainty;
  source?: ProfitLineSource;
  amountGross?: string;
  amountVat?: string;
  vatRatePct?: string | null;
  inputs?: Prisma.InputJsonValue;
  externalRecordId?: string | null;
  externalRecordType?: string | null;
}

/**
 * One profit line. Defaults to an item-level, estimated COGS cost line with
 * zero amounts; pass overrides for the type/level/certainty/source and amounts
 * a test needs. An item-level line requires an orderItemId override.
 */
export async function createProfitLine(
  orderId: string,
  organizationId: string,
  storeId: string,
  overrides: CreateProfitLineOverrides = {},
) {
  return prisma.profitLine.create({
    data: {
      organizationId,
      storeId,
      orderId,
      orderItemId: overrides.orderItemId ?? null,
      type: overrides.type ?? 'COST_COGS',
      level: overrides.level ?? 'ITEM',
      certainty: overrides.certainty ?? 'ESTIMATE',
      source: overrides.source ?? 'SELLER_INPUT',
      amountGross: overrides.amountGross ?? '0',
      amountVat: overrides.amountVat ?? '0',
      vatRatePct: overrides.vatRatePct ?? null,
      inputs: overrides.inputs ?? {},
      externalRecordId: overrides.externalRecordId ?? null,
      externalRecordType: overrides.externalRecordType ?? null,
      engineVersion: PROFIT_ENGINE_VERSION,
    },
  });
}

/** Code prefix of a test-created carrier; `ensureShippingReferenceData` prunes `TEST%` strays. */
const TEST_CARRIER_CODE_PREFIX = 'TEST_';

/** Barem delivery window a test tariff version gets when the spec leaves it out. */
const DEFAULT_TEST_BAREM_DELIVERY_DURATION = 1;

/** Barem price table a test Barem row gets when the spec leaves it out. */
const DEFAULT_TEST_BAREM_TIER: BaremTier = 'TABLE_1';

/** One dated tariff version of a test carrier: its start, Barem attributes and rows. */
export interface TestCarrierTariffVersionSpec {
  effectiveFrom: Date;
  supportsBaremDestek: boolean;
  maxBaremDesi: number;
  /** Defaults to 1 day. */
  maxBaremEligibleDeliveryDuration?: number;
  /** Whether a Barem table 1 order's return is priced at table 1; defaults to false. */
  baremAppliesToReturns?: boolean;
  desiRows: readonly { desi: number; priceNet: string }[];
  baremRows: readonly {
    /** Defaults to TABLE_1. */
    tier?: BaremTier;
    minOrderAmount: string;
    maxOrderAmount: string;
    priceNet: string;
  }[];
}

export interface CreateTestCarrierWithVersionsSpec {
  /** Must start with `TEST_`, so the carrier never collides with a seeded one. */
  code: string;
  externalId: number;
  /** Defaults to the code. */
  displayName?: string;
  orderCargoNames?: readonly string[];
  versions: readonly TestCarrierTariffVersionSpec[];
}

/**
 * Creates a TRENDYOL test carrier with one dated tariff version per spec entry,
 * each with its own desi and Barem rows, in a single nested write. Returns the
 * carrier id. The shipping reference tables are never truncated, so the caller
 * deletes the carrier when done (its versions and rows cascade).
 */
export async function createTestCarrierWithVersions(
  spec: CreateTestCarrierWithVersionsSpec,
): Promise<string> {
  if (!spec.code.startsWith(TEST_CARRIER_CODE_PREFIX)) {
    throw new Error(
      `Test carrier code must start with ${TEST_CARRIER_CODE_PREFIX}, got ${spec.code}`,
    );
  }
  const carrier = await prisma.shippingCarrier.create({
    data: {
      platform: 'TRENDYOL',
      externalId: spec.externalId,
      code: spec.code,
      displayName: spec.displayName ?? spec.code,
      orderCargoNames: [...(spec.orderCargoNames ?? [])],
      tariffVersions: {
        create: spec.versions.map((version) => ({
          effectiveFrom: version.effectiveFrom,
          supportsBaremDestek: version.supportsBaremDestek,
          maxBaremDesi: version.maxBaremDesi,
          maxBaremEligibleDeliveryDuration:
            version.maxBaremEligibleDeliveryDuration ?? DEFAULT_TEST_BAREM_DELIVERY_DURATION,
          baremAppliesToReturns: version.baremAppliesToReturns ?? false,
          desiTariffs: {
            create: version.desiRows.map((row) => ({ desi: row.desi, priceNet: row.priceNet })),
          },
          baremTariffs: {
            create: version.baremRows.map((row) => ({
              tier: row.tier ?? DEFAULT_TEST_BAREM_TIER,
              minOrderAmount: row.minOrderAmount,
              maxOrderAmount: row.maxOrderAmount,
              priceNet: row.priceNet,
            })),
          },
        })),
      },
    },
    select: { id: true },
  });
  return carrier.id;
}
