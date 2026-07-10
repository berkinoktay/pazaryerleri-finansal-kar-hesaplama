import { randomUUID } from 'node:crypto';

import type {
  BufferEntryStatus,
  CostProfileType,
  FeeCalculationKind,
  MemberRole,
  OrderFeeDirection,
  OrderFeeSource,
  OrderFeeType,
  OrderStatus,
  Platform,
  Prisma,
  StoreEnvironment,
  StoreStatus,
} from '@pazarsync/db';

import { prisma } from './db';

// Re-exported so test files can write `import type { MemberRole } from
// '../helpers/factories'` without reaching into @pazarsync/db directly —
// the helpers module is the canonical seam for tests, and this avoids
// every test file growing a second package import.
export type {
  FeeCalculationKind,
  MemberRole,
  OrderFeeDirection,
  OrderFeeSource,
  OrderFeeType,
} from '@pazarsync/db';

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
  estimatedNetProfit?: string | null;
  // Persist edilen marj (estimatedNetProfit / saleGross × 100). Live-performance +
  // order detayı bu kolondan okur (render-time hesap yok). null = henüz hesaplanmadı.
  estimatedSaleMarginPct?: string | null;
  // Promosyon adları + brüt tutarları (spec ekleme #3). Order upsert'in yazdığı
  // JSON; liste/detay/canlı-performans bu kolondan servis eder. null = indirimsiz.
  promotionDisplays?: { displayName: string; amountGross: string }[] | null;
  // Buffer-graduation marker: non-null when the order came from the
  // live-performance buffer (drives the notification summary's isPromotion flag).
  promotedFromBufferAt?: Date | null;
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
      estimatedNetProfit: overrides.estimatedNetProfit ?? null,
      estimatedSaleMarginPct: overrides.estimatedSaleMarginPct ?? null,
      // Omit (undefined) → column stays SQL NULL, matching the order upsert's
      // no-promotion write. A provided array is stored verbatim as JSON.
      promotionDisplays: overrides.promotionDisplays ?? undefined,
      promotedFromBufferAt: overrides.promotedFromBufferAt ?? null,
    },
  });
}

export interface CreateOrderItemOverrides {
  quantity?: number;
  // GROSS CONVENTION (2026-06-16): lineSaleGross replaces unitPrice; commissionGross
  // replaces commissionAmount. unitCostSnapshotGross (KDV-dahil) replaces unitCostSnapshotNet.
  lineSaleGross?: string;
  commissionRate?: string;
  commissionGross?: string;
  // GROSS cost snapshot — drives the costed-cost aggregate. null = cost-missing line.
  unitCostSnapshotGross?: string | null;
  productVariantId?: string | null;
}

/**
 * One order line. `quantity` feeds "units sold"; `unitCostSnapshotGross` (KDV-dahil)
 * feeds the costed-cost denominator of the Kâr/Maliyet ratio. Money columns default
 * to zero — tests that only exercise aggregates don't depend on them.
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
      commissionRate: overrides.commissionRate ?? '0.00',
      commissionGross: overrides.commissionGross ?? '0.00',
      unitCostSnapshotGross: overrides.unitCostSnapshotGross ?? null,
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

export async function createOrderFee(
  orderId: string,
  organizationId: string,
  overrides: {
    feeType?: OrderFeeType;
    source?: OrderFeeSource;
    direction?: OrderFeeDirection;
    // GROSS CONVENTION (2026-06-16): amountGross (KDV-dahil) + vatRate. Net = gross × 100/(100+rate).
    amountGross?: string;
    vatRate?: string;
    feeDefinitionId?: string | null;
    // SETTLEMENT rows carry the Trendyol row id (#297 idempotency column).
    trendyolTransactionId?: string | null;
    // Omit to take the DB default (now()); set to place a fee outside a
    // capturedAt-windowed aggregate (e.g. the claims summary period).
    capturedAt?: Date;
  } = {},
) {
  return prisma.orderFee.create({
    data: {
      orderId,
      organizationId,
      feeDefinitionId: overrides.feeDefinitionId ?? null,
      feeType: overrides.feeType ?? 'PLATFORM_SERVICE',
      source: overrides.source ?? 'ESTIMATE',
      direction: overrides.direction ?? 'DEBIT',
      amountGross: overrides.amountGross ?? '13.19',
      vatRate: overrides.vatRate ?? '20.00',
      trendyolTransactionId: overrides.trendyolTransactionId ?? null,
      ...(overrides.capturedAt !== undefined ? { capturedAt: overrides.capturedAt } : {}),
    },
  });
}

export async function createOrderClaim(
  organizationId: string,
  storeId: string,
  orderId: string,
  overrides: {
    trendyolClaimId?: string;
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
      trendyolClaimId: overrides.trendyolClaimId ?? `claim-${randomUUID().slice(0, 8)}`,
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
    trendyolClaimItemId?: string;
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
      trendyolClaimItemId:
        overrides.trendyolClaimItemId ?? `claim-item-${randomUUID().slice(0, 8)}`,
      reasonCode: overrides.reasonCode ?? 'DAMAGEDITEM',
      reasonName: overrides.reasonName ?? 'Hasarlı Ürün',
      status: overrides.status ?? 'Pending',
      acceptedBySeller: overrides.acceptedBySeller ?? false,
      resolved: overrides.resolved ?? false,
    },
  });
}

export async function createOrgPeriodFee(
  organizationId: string,
  storeId: string,
  overrides: {
    paymentOrderId?: bigint;
    paymentDate?: Date;
    feeType?: OrderFeeType;
    source?: OrderFeeSource;
    // GROSS CONVENTION (2026-06-16, Bölüm E Task 20): amountGross + vatRate.
    // Default: 60.00 gross (50.00 net × 1.20) at vatRate=20.
    amountGross?: string;
    vatRate?: string;
  } = {},
) {
  return prisma.orgPeriodFee.create({
    data: {
      organizationId,
      storeId,
      paymentOrderId: overrides.paymentOrderId ?? BigInt(1000000),
      paymentDate: overrides.paymentDate ?? new Date(),
      feeType: overrides.feeType ?? 'ADVERTISING',
      source: overrides.source ?? 'SETTLEMENT',
      amountGross: overrides.amountGross ?? '60.00',
      vatRate: overrides.vatRate ?? '20.00',
    },
  });
}

export async function createCommissionInvoice(
  organizationId: string,
  storeId: string,
  overrides: {
    trendyolSerialNumber?: string;
    periodStart?: Date;
    periodEnd?: Date;
    totalNet?: string;
    totalVat?: string;
  } = {},
) {
  return prisma.commissionInvoice.create({
    data: {
      organizationId,
      storeId,
      trendyolSerialNumber: overrides.trendyolSerialNumber ?? `DCF${randomUUID().slice(0, 13)}`,
      periodStart: overrides.periodStart ?? new Date('2026-05-01'),
      periodEnd: overrides.periodEnd ?? new Date('2026-05-07'),
      totalNet: overrides.totalNet ?? '1000.00',
      totalVat: overrides.totalVat ?? '200.00',
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

export async function createCostProfile(
  organizationId: string,
  overrides: { storeId?: string; name?: string; type?: CostProfileType; amountGross?: string } = {},
) {
  // GROSS konvansiyon (2026-06-16): amountGross is GROSS (KDV-dahil) + vatRate.
  // A cost snapshot captured from this profile is fully specified (gross + rate),
  // which is what the estimate path needs to compute a non-null estimatedNetProfit.
  //
  // storeId is required on the model (cost profiles are store-scoped). Tests that
  // attach a profile to a variant MUST pass the variant's storeId so both share a
  // store (the attach guard rejects a cross-store attach); tests that don't care
  // get a throwaway store auto-created here.
  const storeId = overrides.storeId ?? (await createStore(organizationId)).id;
  return prisma.costProfile.create({
    data: {
      organizationId,
      storeId,
      name: overrides.name ?? `COGS-${randomUUID().slice(0, 8)}`,
      type: overrides.type ?? 'COGS',
      amountGross: overrides.amountGross ?? '60.00',
      currency: 'TRY',
      vatRate: 20,
    },
  });
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
      orderDate: overrides.orderDate ?? new Date(),
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
