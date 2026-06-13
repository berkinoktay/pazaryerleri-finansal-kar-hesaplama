/**
 * Integration tests for PATCH .../variants/:variantId/dimensional-weight.
 *
 * Verifies:
 *   1. Happy path: setting a valid decimal updates ONLY dimensional_weight,
 *      leaves synced_dimensional_weight untouched.
 *   2. Null body clears the override; effective value falls back to synced.
 *   3. Invalid bodies (bad format, out-of-range) → 422 VALIDATION_ERROR.
 *   4. 404 when the variant doesn't exist.
 *
 * Cross-org isolation lives in tests/integration/tenant-isolation/.
 */

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore } from '../../helpers/factories';

const app = createApp();

interface Ctx {
  accessToken: string;
  orgId: string;
  storeId: string;
  variantId: string;
}

async function setup(opts: { syncedDimensionalWeight?: string } = {}): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);

  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-${randomUUID().slice(0, 8)}`,
      title: 'Desi Test Product',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: `BC-${randomUUID().slice(0, 8)}`,
      stockCode: `STK-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('100.00'),
      listPrice: new Decimal('100.00'),
      ...(opts.syncedDimensionalWeight !== undefined
        ? { syncedDimensionalWeight: opts.syncedDimensionalWeight }
        : {}),
    },
  });

  return {
    accessToken: user.accessToken,
    orgId: org.id,
    storeId: store.id,
    variantId: variant.id,
  };
}

function patchUrl(ctx: Ctx): string {
  return `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products/variants/${ctx.variantId}/dimensional-weight`;
}

async function patchDesi(ctx: Ctx, body: unknown): Promise<Response> {
  return app.request(patchUrl(ctx), {
    method: 'PATCH',
    headers: {
      Authorization: bearer(ctx.accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH .../variants/:variantId/dimensional-weight', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('happy path: sets the user override, leaves synced column untouched', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.20' });

    const res = await patchDesi(ctx, { dimensionalWeight: '2.50' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      dimensionalWeight: string;
      syncedDimensionalWeight: string;
      isDimensionalWeightOverridden: boolean;
    };
    expect(body.id).toBe(ctx.variantId);
    expect(body.dimensionalWeight).toBe('2.5');
    expect(body.syncedDimensionalWeight).toBe('1.2');
    expect(body.isDimensionalWeightOverridden).toBe(true);

    // DB-level assertion: synced column is the EXACT same row as before.
    const row = await prisma.productVariant.findFirstOrThrow({ where: { id: ctx.variantId } });
    expect(row.dimensionalWeight?.toString()).toBe('2.5');
    expect(row.syncedDimensionalWeight?.toString()).toBe('1.2');
  });

  it('null body clears the override; effective value falls back to synced', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.20' });
    // First, set an override
    await prisma.productVariant.update({
      where: { id: ctx.variantId },
      data: { dimensionalWeight: '5.00' },
    });

    const res = await patchDesi(ctx, { dimensionalWeight: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dimensionalWeight: string;
      isDimensionalWeightOverridden: boolean;
    };
    expect(body.dimensionalWeight).toBe('1.2'); // fell back to synced
    expect(body.isDimensionalWeightOverridden).toBe(false);

    const row = await prisma.productVariant.findFirstOrThrow({ where: { id: ctx.variantId } });
    expect(row.dimensionalWeight).toBeNull();
    expect(row.syncedDimensionalWeight?.toString()).toBe('1.2');
  });

  it('returns 422 INVALID_DIMENSIONAL_WEIGHT_FORMAT for a non-decimal string', async () => {
    const ctx = await setup();

    const res = await patchDesi(ctx, { dimensionalWeight: 'not-a-number' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      errors: { field: string; code: string }[];
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_FORMAT')).toBe(true);
  });

  it('returns 422 INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE when value exceeds the soft cap', async () => {
    const ctx = await setup();

    const res = await patchDesi(ctx, { dimensionalWeight: '1500.00' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE')).toBe(true);
  });

  it('accepts 0 (the floor) as a valid desi override; rejects negatives as a format error', async () => {
    const ctx = await setup({ syncedDimensionalWeight: '1.20' });

    // 0 is the floor — a valid override (desi 0 resolves the lowest tariff tier).
    const ok = await patchDesi(ctx, { dimensionalWeight: '0' });
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as {
      dimensionalWeight: string;
      isDimensionalWeightOverridden: boolean;
    };
    expect(okBody.dimensionalWeight).toBe('0');
    expect(okBody.isDimensionalWeightOverridden).toBe(true);
    const row = await prisma.productVariant.findFirstOrThrow({ where: { id: ctx.variantId } });
    expect(row.dimensionalWeight?.toString()).toBe('0');

    // Below 0 is impossible — the format regex admits no minus sign, so a
    // negative is a FORMAT error, never reaching the DB CHECK floor.
    const neg = await patchDesi(ctx, { dimensionalWeight: '-1' });
    expect(neg.status).toBe(422);
    const negBody = (await neg.json()) as { errors: { code: string }[] };
    expect(negBody.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_FORMAT')).toBe(true);
  });

  it('returns 404 NOT_FOUND when the variant does not exist within the store', async () => {
    const ctx = await setup();
    const fakeVariantId = randomUUID();
    const res = await app.request(
      `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products/variants/${fakeVariantId}/dimensional-weight`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearer(ctx.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dimensionalWeight: '1.00' }),
      },
    );
    expect(res.status).toBe(404);
  });
});
