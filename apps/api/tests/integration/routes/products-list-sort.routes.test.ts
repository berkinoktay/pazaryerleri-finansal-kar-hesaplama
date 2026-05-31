// sort=salePrice / -salePrice on GET /products. Verifies the denormalized
// Product.minSalePrice / maxSalePrice columns (PR-B1) drive the ordering —
// replacing the old platformCreatedAt fallback. Ascending orders by the
// product's lowest variant price, descending by its highest; the two are
// intentionally NOT strict reverses (a multi-variant product has no single
// price), so this test pins both directions independently.

import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

interface PriceSpec {
  title: string;
  min: string;
  max: string;
}

// min/max chosen so the two sort directions disagree on order:
//   asc  by min:  Cheap(10) < Mid(15) < Pricey(30)
//   desc by max:  Mid(60)   > Pricey(40) > Cheap(20)
const PRODUCTS: PriceSpec[] = [
  { title: 'Cheap', min: '10.00', max: '20.00' },
  { title: 'Mid', min: '15.00', max: '60.00' },
  { title: 'Pricey', min: '30.00', max: '40.00' },
];

async function setupStoreWithPricedProducts(): Promise<{
  user: { accessToken: string };
  orgId: string;
  storeId: string;
}> {
  const user = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id);
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Sort Store',
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: 'sort-seller',
      credentials: encryptCredentials({ supplierId: '2738', apiKey: 'k', apiSecret: 's' }),
    },
  });

  for (const [i, spec] of PRODUCTS.entries()) {
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(1000 + i),
        productMainId: `pm-${i.toString()}`,
        title: spec.title,
        minSalePrice: spec.min,
        maxSalePrice: spec.max,
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: BigInt(10000 + i),
        barcode: `bc-${i.toString()}`,
        stockCode: `sk-${i.toString()}`,
        salePrice: spec.min,
        listPrice: spec.max,
      },
    });
  }

  return { user: { accessToken: user.accessToken }, orgId: org.id, storeId: store.id };
}

async function listTitles(
  orgId: string,
  storeId: string,
  accessToken: string,
  sort: string,
): Promise<string[]> {
  const res = await app.request(
    `/v1/organizations/${orgId}/stores/${storeId}/products?sort=${sort}`,
    { headers: { Authorization: bearer(accessToken) } },
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { title: string }[] };
  return body.data.map((p) => p.title);
}

describe('GET /products — sort=salePrice reads denormalized min/max columns', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('sort=salePrice orders ascending by the product’s minSalePrice', async () => {
    const { user, orgId, storeId } = await setupStoreWithPricedProducts();
    const titles = await listTitles(orgId, storeId, user.accessToken, 'salePrice');
    expect(titles).toEqual(['Cheap', 'Mid', 'Pricey']);
  });

  it('sort=-salePrice orders descending by the product’s maxSalePrice', async () => {
    const { user, orgId, storeId } = await setupStoreWithPricedProducts();
    const titles = await listTitles(orgId, storeId, user.accessToken, '-salePrice');
    expect(titles).toEqual(['Mid', 'Pricey', 'Cheap']);
  });
});
