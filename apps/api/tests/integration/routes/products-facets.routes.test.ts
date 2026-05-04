import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

describe('GET /v1/.../products/facets — overrideCounts', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns counts of products with ≥1 variant missing cost/vat plus total', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Test Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '5000',
        credentials: encryptCredentials({
          supplierId: '5000',
          apiKey: 'k',
          apiSecret: 's',
        }),
      },
    });

    // P1: one variant, no cost, no vat → contributes to both
    const p1 = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(5001),
        productMainId: 'P1',
        title: 'P1',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: p1.id,
        platformVariantId: BigInt(5101),
        barcode: 'B1',
        stockCode: 'S1',
        salePrice: '10',
        listPrice: '10',
      },
    });
    // P2: one variant, cost set, vat set → contributes to total only
    const p2 = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(5002),
        productMainId: 'P2',
        title: 'P2',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: p2.id,
        platformVariantId: BigInt(5102),
        barcode: 'B2',
        stockCode: 'S2',
        salePrice: '10',
        listPrice: '10',
        costPrice: '5',
        vatRate: 18,
      },
    });
    // P3: one variant, cost set, vat null → contributes to missingVat + total
    const p3 = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(5003),
        productMainId: 'P3',
        title: 'P3',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: p3.id,
        platformVariantId: BigInt(5103),
        barcode: 'B3',
        stockCode: 'S3',
        salePrice: '10',
        listPrice: '10',
        costPrice: '5',
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/products/facets`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      overrideCounts: { missingCost: number; missingVat: number; total: number };
    };
    expect(body.overrideCounts).toEqual({ missingCost: 1, missingVat: 2, total: 3 });
  });
});
