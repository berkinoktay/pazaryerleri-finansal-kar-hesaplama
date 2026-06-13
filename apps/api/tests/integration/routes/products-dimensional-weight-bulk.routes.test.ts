/**
 * Integration tests for PATCH .../products/variants/dimensional-weight (bulk).
 *
 * Covers:
 *   1. Happy path: every variant in the array gets the override.
 *   2. Cross-tenant IDs are silently filtered out (never mutated).
 *   3. Null body clears overrides across all listed variants.
 *   4. Empty / oversized / malformed input → 422.
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
}

async function setupCtx(): Promise<Ctx> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await createStore(org.id);
  return { accessToken: user.accessToken, orgId: org.id, storeId: store.id };
}

async function seedVariant(
  ctx: Ctx,
  opts: { syncedDimensionalWeight?: string; dimensionalWeight?: string | null } = {},
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      productMainId: `pm-${randomUUID().slice(0, 8)}`,
      title: 'Bulk Desi Test',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: ctx.orgId,
      storeId: ctx.storeId,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000_000)),
      barcode: `BC-${randomUUID().slice(0, 8)}`,
      stockCode: `STK-${randomUUID().slice(0, 8)}`,
      salePrice: new Decimal('100.00'),
      listPrice: new Decimal('100.00'),
      ...(opts.syncedDimensionalWeight !== undefined
        ? { syncedDimensionalWeight: opts.syncedDimensionalWeight }
        : {}),
      ...(opts.dimensionalWeight !== undefined
        ? { dimensionalWeight: opts.dimensionalWeight }
        : {}),
    },
  });
  return variant.id;
}

function bulkUrl(ctx: Ctx): string {
  return `/v1/organizations/${ctx.orgId}/stores/${ctx.storeId}/products/variants/dimensional-weight`;
}

async function bulkPatch(ctx: Ctx, body: unknown): Promise<Response> {
  return app.request(bulkUrl(ctx), {
    method: 'PATCH',
    headers: {
      Authorization: bearer(ctx.accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH .../products/variants/dimensional-weight (bulk)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('applies the value to every listed variant and returns the updated count', async () => {
    const ctx = await setupCtx();
    const v1 = await seedVariant(ctx, { syncedDimensionalWeight: '1.00' });
    const v2 = await seedVariant(ctx, { syncedDimensionalWeight: '2.00' });
    const v3 = await seedVariant(ctx, { syncedDimensionalWeight: '3.00' });

    const res = await bulkPatch(ctx, { variantIds: [v1, v2, v3], dimensionalWeight: '7.50' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(3);

    const rows = await prisma.productVariant.findMany({
      where: { id: { in: [v1, v2, v3] } },
      orderBy: { syncedDimensionalWeight: 'asc' },
    });
    for (const r of rows) {
      expect(r.dimensionalWeight?.toString()).toBe('7.5');
    }
    // Synced column untouched.
    expect(rows.map((r) => r.syncedDimensionalWeight?.toString())).toEqual(['1', '2', '3']);
  });

  it('null body clears overrides across all listed variants', async () => {
    const ctx = await setupCtx();
    const v1 = await seedVariant(ctx, {
      syncedDimensionalWeight: '1.00',
      dimensionalWeight: '9.00',
    });
    const v2 = await seedVariant(ctx, {
      syncedDimensionalWeight: '2.00',
      dimensionalWeight: '9.00',
    });

    const res = await bulkPatch(ctx, { variantIds: [v1, v2], dimensionalWeight: null });
    expect(res.status).toBe(200);

    const rows = await prisma.productVariant.findMany({ where: { id: { in: [v1, v2] } } });
    for (const r of rows) {
      expect(r.dimensionalWeight).toBeNull();
    }
  });

  it('silently filters cross-tenant IDs — never mutates the other org', async () => {
    const ctxA = await setupCtx();
    const ctxB = await setupCtx();
    const v1A = await seedVariant(ctxA, { syncedDimensionalWeight: '1.00' });
    const v1B = await seedVariant(ctxB, {
      syncedDimensionalWeight: '5.00',
      dimensionalWeight: null,
    });

    // Org A submits its own variant + Org B's variant. Only A's should land.
    const res = await bulkPatch(ctxA, {
      variantIds: [v1A, v1B],
      dimensionalWeight: '4.00',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(1);

    const aRow = await prisma.productVariant.findFirstOrThrow({ where: { id: v1A } });
    const bRow = await prisma.productVariant.findFirstOrThrow({ where: { id: v1B } });
    expect(aRow.dimensionalWeight?.toString()).toBe('4');
    expect(bRow.dimensionalWeight).toBeNull(); // Org B untouched.
  });

  it('rejects empty variantIds with 422 INVALID_VARIANT_IDS_EMPTY', async () => {
    const ctx = await setupCtx();
    const res = await bulkPatch(ctx, { variantIds: [], dimensionalWeight: '1.00' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors.some((e) => e.code === 'INVALID_VARIANT_IDS_EMPTY')).toBe(true);
  });

  it('rejects > 200 variantIds with 422 INVALID_VARIANT_IDS_TOO_MANY', async () => {
    const ctx = await setupCtx();
    const variantIds = Array.from({ length: 201 }, () => randomUUID());
    const res = await bulkPatch(ctx, { variantIds, dimensionalWeight: '1.00' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { code: string }[] };
    expect(body.errors.some((e) => e.code === 'INVALID_VARIANT_IDS_TOO_MANY')).toBe(true);
  });

  it('rejects out-of-range dimensionalWeight with 422 (above the cap); 0 is the valid floor', async () => {
    const ctx = await setupCtx();
    const v = await seedVariant(ctx);

    // Above the cap → TOO_LARGE.
    const tooLarge = await bulkPatch(ctx, { variantIds: [v], dimensionalWeight: '1500.00' });
    expect(tooLarge.status).toBe(422);
    const tooLargeBody = (await tooLarge.json()) as { errors: { code: string }[] };
    expect(tooLargeBody.errors.some((e) => e.code === 'INVALID_DIMENSIONAL_WEIGHT_TOO_LARGE')).toBe(
      true,
    );

    // 0 is the floor — accepted.
    const zero = await bulkPatch(ctx, { variantIds: [v], dimensionalWeight: '0' });
    expect(zero.status).toBe(200);
  });
});
