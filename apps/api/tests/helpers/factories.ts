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
  // PR-5c (2026-05-19): eski Order ücret kolonları (totalAmount, commissionAmount,
  // shippingCost) silindi. Yeni convention (saleSubtotalNet / saleVatTotal /
  // estimatedNetProfit) PR-E (Live Performance) ile override edilebilir hale geldi —
  // KPI/chart/orders aggregate'leri bu kolonlardan okuyor. Decimal kolonları string
  // alır (Prisma coerce eder); null = "henüz hesaplanmadı".
  orderDate?: Date;
  platformOrderId?: string;
  platformOrderNumber?: string | null;
  saleSubtotalNet?: string | null;
  saleVatTotal?: string | null;
  estimatedNetProfit?: string | null;
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
      saleSubtotalNet: overrides.saleSubtotalNet ?? null,
      saleVatTotal: overrides.saleVatTotal ?? null,
      estimatedNetProfit: overrides.estimatedNetProfit ?? null,
    },
  });
}

export interface CreateOrderItemOverrides {
  quantity?: number;
  unitPrice?: string;
  commissionRate?: string;
  commissionAmount?: string;
  // NET cost snapshot — drives the costed-cost aggregate (Σ unitCostSnapshotNet ×
  // quantity over costed orders). null = cost-missing line.
  unitCostSnapshotNet?: string | null;
  productVariantId?: string | null;
}

/**
 * One order line. `quantity` feeds "units sold"; `unitCostSnapshotNet` feeds the
 * costed-cost denominator of the Kâr/Maliyet ratio. The three required money
 * columns (unitPrice / commissionRate / commissionAmount) default to zero — tests
 * that only exercise the live-performance aggregates don't depend on them.
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
      unitPrice: overrides.unitPrice ?? '0.00',
      commissionRate: overrides.commissionRate ?? '0.00',
      commissionAmount: overrides.commissionAmount ?? '0.00',
      unitCostSnapshotNet: overrides.unitCostSnapshotNet ?? null,
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
    amountNet?: string;
    vatRate?: string;
    vatAmount?: string;
    feeDefinitionId?: string | null;
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
      amountNet: overrides.amountNet ?? '10.99',
      vatRate: overrides.vatRate ?? '20.00',
      vatAmount: overrides.vatAmount ?? '2.20',
    },
  });
}

export async function createOrderClaim(
  organizationId: string,
  orderId: string,
  overrides: {
    trendyolClaimId?: string;
    claimDate?: Date;
    resolved?: boolean;
  } = {},
) {
  return prisma.orderClaim.create({
    data: {
      organizationId,
      orderId,
      trendyolClaimId: overrides.trendyolClaimId ?? `claim-${randomUUID().slice(0, 8)}`,
      claimDate: overrides.claimDate ?? new Date(),
      resolved: overrides.resolved ?? false,
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
    amountNet?: string;
    vatRate?: string;
    vatAmount?: string;
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
      amountNet: overrides.amountNet ?? '50.00',
      vatRate: overrides.vatRate ?? '20.00',
      vatAmount: overrides.vatAmount ?? '10.00',
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
  overrides: { name?: string; type?: CostProfileType; amount?: string } = {},
) {
  // amount is NET (KDV hariç). vatRate + vatAmount are set so a cost snapshot
  // captured from this profile is fully specified (net + vat), which is what
  // the estimate path needs to compute a non-null estimatedNetProfit.
  return prisma.costProfile.create({
    data: {
      organizationId,
      name: overrides.name ?? `COGS-${randomUUID().slice(0, 8)}`,
      type: overrides.type ?? 'COGS',
      amount: overrides.amount ?? '50.00',
      currency: 'TRY',
      vatRate: 20,
      vatAmount: '10.00',
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
