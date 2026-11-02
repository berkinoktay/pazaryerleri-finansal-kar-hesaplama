/**
 * Integration tests for the cost-aggregate fields on the products list response.
 *
 * Each variant carries:
 *   currentCostTry: string | null
 *   profileCount: number
 *   costStatus: 'OK' | 'NO_PROFILES'
 *
 * Test matrix:
 *   1. Variant with 0 profiles → NO_PROFILES, currentCostTry null
 *   2. 1 profile               → OK, currentCostTry = profile.amount
 *   3. 2 profiles              → OK, currentCostTry = sum
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '../../../src/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedVariant(
  organizationId: string,
  storeId: string,
  productId: string,
  opts: { platformVariantId?: number } = {},
) {
  return prisma.productVariant.create({
    data: {
      organizationId,
      storeId,
      productId,
      platformVariantId: BigInt(opts.platformVariantId ?? Math.floor(Math.random() * 1_000_000)),
      barcode: `BC-${randomUUID().slice(0, 8)}`,
      stockCode: `STK-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('100.00'),
      listPrice: new Decimal('100.00'),
    },
  });
}

async function seedProduct(organizationId: string, storeId: string) {
  return prisma.product.create({
    data: {
      organizationId,
      storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${randomUUID().slice(0, 8)}`,
      title: 'Test Product',
    },
  });
}

async function seedProfile(
  organizationId: string,
  storeId: string,
  opts: { amount: string; name?: string },
) {
  const profile = await prisma.costProfile.create({
    data: {
      organizationId,
      storeId,
      name: opts.name ?? `Profile ${randomUUID().slice(0, 6)}`,
      type: 'COGS',
      amountGross: new Decimal(opts.amount),
      vatRate: 0,
    },
  });
  return profile;
}

async function attachProfile(organizationId: string, profileId: string, variantId: string) {
  return prisma.productVariantCostProfile.create({
    data: { organizationId, profileId, productVariantId: variantId },
  });
}

// ─── Test setup ───────────────────────────────────────────────────────────────

interface TestCtx {
  accessToken: string;
  orgId: string;
  storeId: string;
}

async function setup(): Promise<TestCtx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

interface VariantBody {
  id: string;
  profileCount: number;
  costStatus: string;
  currentCostTry: string | null;
}

async function getVariants(ctx: TestCtx): Promise<VariantBody[]> {
  const url = `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products`;
  const res = await app.request(url, {
    headers: { Authorization: bearer(ctx.accessToken) },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { variants: VariantBody[] }[] };
  return body.data.flatMap((p) => p.variants);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /products — cost aggregate fields', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('variant with 0 profiles → NO_PROFILES, null currentCostTry', async () => {
    const ctx = await setup();
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    await seedVariant(ctx.orgId, ctx.storeId, product.id);

    const variants = await getVariants(ctx);
    expect(variants).toHaveLength(1);
    expect(variants[0]?.profileCount).toBe(0);
    expect(variants[0]?.costStatus).toBe('NO_PROFILES');
    expect(variants[0]?.currentCostTry).toBeNull();
  });

  it('1 profile → OK, currentCostTry = profile amount', async () => {
    const ctx = await setup();
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    const variant = await seedVariant(ctx.orgId, ctx.storeId, product.id);
    const profile = await seedProfile(ctx.orgId, ctx.storeId, { amount: '25.50' });
    await attachProfile(ctx.orgId, profile.id, variant.id);

    const variants = await getVariants(ctx);
    expect(variants[0]?.profileCount).toBe(1);
    expect(variants[0]?.costStatus).toBe('OK');
    expect(variants[0]?.currentCostTry).toBe('25.50');
  });

  it('2 profiles → OK, currentCostTry = sum', async () => {
    const ctx = await setup();
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    const variant = await seedVariant(ctx.orgId, ctx.storeId, product.id);
    const first = await seedProfile(ctx.orgId, ctx.storeId, { amount: '15.00', name: 'COGS A' });
    const second = await seedProfile(ctx.orgId, ctx.storeId, { amount: '5.00', name: 'COGS B' });
    await attachProfile(ctx.orgId, first.id, variant.id);
    await attachProfile(ctx.orgId, second.id, variant.id);

    const variants = await getVariants(ctx);
    expect(variants[0]?.profileCount).toBe(2);
    expect(variants[0]?.costStatus).toBe('OK');
    // 15.00 + 5.00 = 20.00
    expect(variants[0]?.currentCostTry).toBe('20.00');
  });

  it('excludes an archived profile from the cost total', async () => {
    const ctx = await setup();
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    const variant = await seedVariant(ctx.orgId, ctx.storeId, product.id);
    const active = await seedProfile(ctx.orgId, ctx.storeId, {
      amount: '100.00',
      name: 'COGS active',
    });
    const archived = await seedProfile(ctx.orgId, ctx.storeId, {
      amount: '40.00',
      name: 'COGS archived',
    });
    await attachProfile(ctx.orgId, active.id, variant.id);
    await attachProfile(ctx.orgId, archived.id, variant.id);
    // Archiving the 40.00 profile must drop it from the cost total: only the active
    // 100.00 profile counts.
    await prisma.costProfile.update({
      where: { id: archived.id },
      data: { archivedAt: new Date() },
    });

    const variants = await getVariants(ctx);
    expect(variants[0]?.costStatus).toBe('OK');
    expect(variants[0]?.currentCostTry).toBe('100.00');
  });
});
