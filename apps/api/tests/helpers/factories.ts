import { randomUUID } from 'node:crypto';

import type {
  MemberRole,
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
export type { MemberRole } from '@pazarsync/db';

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
