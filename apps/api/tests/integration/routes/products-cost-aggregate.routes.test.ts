/**
 * Integration tests for the cost-aggregate fields on the products list response.
 *
 * Per spec §6.5 each variant now carries:
 *   currentCostTry: string | null
 *   profileCount: number
 *   costStatus: 'OK' | 'NO_PROFILES' | 'FX_STALE' | 'FX_MISSING'
 *
 * Test matrix per spec §5.5 and task 6.1:
 *   1. Variant with 0 profiles      → NO_PROFILES, currentCostTry null
 *   2. 1 TRY profile                → OK, currentCostTry = profile.amount
 *   3. 1 USD AUTO profile with rate → OK, currentCostTry = amount × rate
 *   4. 1 USD AUTO without rate      → FX_MISSING, currentCostTry null
 *   5. 2 mixed profiles             → OK, currentCostTry = sum
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
  opts: {
    amount: string;
    currency?: 'TRY' | 'USD' | 'EUR';
    fxRateMode?: 'AUTO' | 'MANUAL';
    manualFxRate?: string;
    name?: string;
  },
) {
  const profile = await prisma.costProfile.create({
    data: {
      organizationId,
      name: opts.name ?? `Profile ${randomUUID().slice(0, 6)}`,
      type: 'COGS',
      amountGross: new Decimal(opts.amount),
      currency: opts.currency ?? 'TRY',
      vatRate: 0,
      fxRateMode: opts.fxRateMode ?? 'AUTO',
      manualFxRate: opts.manualFxRate ? new Decimal(opts.manualFxRate) : null,
    },
  });
  return profile;
}

async function attachProfile(organizationId: string, profileId: string, variantId: string) {
  return prisma.productVariantCostProfile.create({
    data: { organizationId, profileId, productVariantId: variantId },
  });
}

async function seedFxRate(currency: 'USD' | 'EUR', rateToTry: string, rateDate: Date) {
  return prisma.fxRate.create({
    data: {
      currency,
      rateToTry: new Decimal(rateToTry),
      rateDate,
      source: 'TCMB',
    },
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

  it('1 TRY profile → OK, currentCostTry = profile amount', async () => {
    const ctx = await setup();
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    const variant = await seedVariant(ctx.orgId, ctx.storeId, product.id);
    const profile = await seedProfile(ctx.orgId, { amount: '25.50', currency: 'TRY' });
    await attachProfile(ctx.orgId, profile.id, variant.id);

    const variants = await getVariants(ctx);
    expect(variants[0]?.profileCount).toBe(1);
    expect(variants[0]?.costStatus).toBe('OK');
    expect(variants[0]?.currentCostTry).toBe('25.50');
  });

  it('1 USD AUTO profile with FX rate → OK, currentCostTry = amount × rate', async () => {
    const ctx = await setup();
    // Seed a fresh FX rate (today's date)
    await seedFxRate('USD', '38.50', new Date());
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    const variant = await seedVariant(ctx.orgId, ctx.storeId, product.id);
    const profile = await seedProfile(ctx.orgId, {
      amount: '10.00',
      currency: 'USD',
      fxRateMode: 'AUTO',
    });
    await attachProfile(ctx.orgId, profile.id, variant.id);

    const variants = await getVariants(ctx);
    expect(variants[0]?.profileCount).toBe(1);
    expect(variants[0]?.costStatus).toBe('OK');
    // 10.00 × 38.50 = 385.00
    expect(variants[0]?.currentCostTry).toBe('385.00');
  });

  it('1 USD AUTO profile with no FX rate → FX_MISSING, null currentCostTry', async () => {
    const ctx = await setup();
    // No FX rate seeded
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    const variant = await seedVariant(ctx.orgId, ctx.storeId, product.id);
    const profile = await seedProfile(ctx.orgId, {
      amount: '10.00',
      currency: 'USD',
      fxRateMode: 'AUTO',
    });
    await attachProfile(ctx.orgId, profile.id, variant.id);

    const variants = await getVariants(ctx);
    expect(variants[0]?.profileCount).toBe(1);
    expect(variants[0]?.costStatus).toBe('FX_MISSING');
    expect(variants[0]?.currentCostTry).toBeNull();
  });

  it('2 mixed profiles (TRY + USD AUTO) → OK, currentCostTry = sum', async () => {
    const ctx = await setup();
    await seedFxRate('USD', '40.00', new Date());
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    const variant = await seedVariant(ctx.orgId, ctx.storeId, product.id);
    const tryProfile = await seedProfile(ctx.orgId, {
      amount: '15.00',
      currency: 'TRY',
      name: 'TRY COGS',
    });
    const usdProfile = await seedProfile(ctx.orgId, {
      amount: '5.00',
      currency: 'USD',
      fxRateMode: 'AUTO',
      name: 'USD COGS',
    });
    await attachProfile(ctx.orgId, tryProfile.id, variant.id);
    await attachProfile(ctx.orgId, usdProfile.id, variant.id);

    const variants = await getVariants(ctx);
    expect(variants[0]?.profileCount).toBe(2);
    expect(variants[0]?.costStatus).toBe('OK');
    // 15.00 (TRY) + 5.00 × 40.00 (USD) = 15 + 200 = 215
    expect(variants[0]?.currentCostTry).toBe('215.00');
  });

  it('USD AUTO profile with stale FX rate (>2 days old) → FX_STALE', async () => {
    const ctx = await setup();
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - 3); // 3 days ago
    await seedFxRate('USD', '38.00', staleDate);
    const product = await seedProduct(ctx.orgId, ctx.storeId);
    const variant = await seedVariant(ctx.orgId, ctx.storeId, product.id);
    const profile = await seedProfile(ctx.orgId, {
      amount: '10.00',
      currency: 'USD',
      fxRateMode: 'AUTO',
    });
    await attachProfile(ctx.orgId, profile.id, variant.id);

    const variants = await getVariants(ctx);
    expect(variants[0]?.profileCount).toBe(1);
    expect(variants[0]?.costStatus).toBe('FX_STALE');
  });
});
