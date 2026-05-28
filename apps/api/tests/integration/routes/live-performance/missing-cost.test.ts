import { getBusinessDateAnchor } from '@pazarsync/utils';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';

import { bearer, createAuthenticatedTestUser } from '../../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../../helpers/db';
import {
  createBufferEntry,
  createCostProfile,
  createMembership,
  createOrganization,
  createStore,
} from '../../../helpers/factories';

interface MissingCostBody {
  data: {
    variantId: string;
    barcode: string;
    productName: string;
    thumbUrl: string | null;
    orderCount: number;
    revenueImpact: string;
  }[];
}

async function createVariant(
  orgId: string,
  storeId: string,
  opts: { title: string; barcode: string; seq: number },
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(900000 + opts.seq),
      productMainId: `PM-${opts.seq}`,
      title: opts.title,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(800000 + opts.seq),
      barcode: opts.barcode,
      stockCode: `SC-${opts.seq}`,
      salePrice: '100.00',
      listPrice: '120.00',
    },
  });
  return variant.id;
}

describe('GET /v1/.../live-performance/missing-cost', () => {
  const app = createApp();

  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('groups today’s PENDING buffer entries by barcode for cost-missing variants', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Pamuklu Tişört',
      barcode: 'BC-MISSING',
      seq: 1,
    });

    const today = getBusinessDateAnchor();
    for (let i = 0; i < 2; i++) {
      await createBufferEntry(org.id, store.id, {
        orderDate: today,
        mappedOrder: { lines: [{ barcode: 'BC-MISSING' }], saleSubtotalNet: '100.00' },
      });
    }

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/missing-cost`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as MissingCostBody;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.variantId).toBe(variantId);
    expect(body.data[0]?.barcode).toBe('BC-MISSING');
    expect(body.data[0]?.productName).toBe('Pamuklu Tişört');
    expect(body.data[0]?.orderCount).toBe(2);
    expect(body.data[0]?.revenueImpact).toBe('200.00');
  });

  it('excludes variants that already have a cost profile attached', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const variantId = await createVariant(org.id, store.id, {
      title: 'Costed Variant',
      barcode: 'BC-COSTED',
      seq: 2,
    });
    const profile = await createCostProfile(org.id);
    await prisma.productVariantCostProfile.create({
      data: {
        organizationId: org.id,
        productVariantId: variantId,
        profileId: profile.id,
        attachedBy: user.id,
      },
    });

    await createBufferEntry(org.id, store.id, {
      orderDate: getBusinessDateAnchor(),
      mappedOrder: { lines: [{ barcode: 'BC-COSTED' }], saleSubtotalNet: '100.00' },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/missing-cost`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as MissingCostBody;
    expect(body.data).toHaveLength(0);
  });
});
