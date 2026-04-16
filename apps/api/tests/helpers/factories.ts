import { randomUUID } from "node:crypto";
import { prisma } from "./db";

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
      fullName: overrides.fullName ?? "Test User",
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
      name: overrides.name ?? "Test Organization",
      slug: overrides.slug ?? `test-org-${id.slice(0, 8)}`,
    },
  });
}

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export async function createMembership(
  organizationId: string,
  userId: string,
  role: MemberRole = "OWNER",
) {
  return prisma.organizationMember.create({
    data: { organizationId, userId, role },
  });
}

export interface CreateStoreOverrides {
  name?: string;
  platform?: "TRENDYOL" | "HEPSIBURADA";
}

export async function createStore(
  organizationId: string,
  overrides: CreateStoreOverrides = {},
) {
  return prisma.store.create({
    data: {
      organizationId,
      name: overrides.name ?? "Test Store",
      platform: overrides.platform ?? "TRENDYOL",
      // Encrypted credential placeholder — never use real credentials in tests
      credentials: {
        ciphertext: "test-ciphertext",
        iv: "test-iv",
        authTag: "test-auth-tag",
      },
    },
  });
}

export interface CreateOrderOverrides {
  totalAmount?: string;
  commissionAmount?: string;
  shippingCost?: string;
  status?: "PENDING" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "RETURNED";
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
      status: overrides.status ?? "DELIVERED",
      totalAmount: overrides.totalAmount ?? "100.00",
      commissionAmount: overrides.commissionAmount ?? "20.00",
      shippingCost: overrides.shippingCost ?? "10.00",
    },
  });
}
