import { randomUUID } from 'node:crypto';

import type {
  FeeCalculationKind,
  MemberRole,
  OrderFeeDirection,
  OrderFeeSource,
  OrderFeeType,
  OrderStatus,
  Platform,
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

export interface CreateOrderOverrides {
  totalAmount?: string;
  commissionAmount?: string;
  shippingCost?: string;
  status?: OrderStatus;
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
      platformOrderId: `test-order-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: overrides.status ?? 'DELIVERED',
      totalAmount: overrides.totalAmount ?? '100.00',
      commissionAmount: overrides.commissionAmount ?? '20.00',
      shippingCost: overrides.shippingCost ?? '10.00',
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
