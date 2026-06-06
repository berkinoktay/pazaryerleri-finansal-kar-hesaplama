import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, prisma, truncateAll } from '../../helpers/db';
import {
  createBufferEntry,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';

async function seedVariant(
  orgId: string,
  storeId: string,
  opts: { title: string; barcode: string; seq: number },
): Promise<string> {
  const product = await prisma.product.create({
    data: {
      organizationId: orgId,
      storeId,
      platformContentId: BigInt(920000 + opts.seq),
      productMainId: `PM-${opts.seq}`,
      title: opts.title,
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: orgId,
      storeId,
      productId: product.id,
      platformVariantId: BigInt(820000 + opts.seq),
      barcode: opts.barcode,
      stockCode: `SC-${opts.seq}`,
      salePrice: '100.00',
      listPrice: '120.00',
    },
  });
  return variant.id;
}

describe('GET live-performance/buffer/{bufferId}', () => {
  const app = createApp();
  beforeAll(async () => {
    await ensureDbReachable();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns the enriched buffer detail (productName via barcode to variant)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const variantId = await seedVariant(org.id, store.id, {
      title: 'Cotton Tee',
      barcode: 'BC-1',
      seq: 1,
    });

    const bufferEntry = await createBufferEntry(org.id, store.id, {
      platformOrderNumber: 'TY-123',
      mappedOrder: {
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleSubtotalNet: '200.00',
        lines: [{ barcode: 'BC-1', quantity: 2, unitPriceNet: '100.00' }],
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/${bufferEntry.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.platformOrderNumber).toBe('TY-123');
    expect(body.saleSubtotalNet).toBe('200.00');
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      barcode: 'BC-1',
      productName: 'Cotton Tee',
      quantity: 2,
      unitPriceNet: '100.00',
      variantId,
      stockCode: 'SC-1',
    });
  });

  it('falls back gracefully when a barcode has no matching variant (variantId null, name = barcode)', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const bufferEntry = await createBufferEntry(org.id, store.id, {
      mappedOrder: {
        orderDate: '2026-06-05T08:00:00.000Z',
        status: 'PENDING',
        saleSubtotalNet: '50.00',
        lines: [{ barcode: 'BC-NONE', quantity: 1, unitPriceNet: '50.00' }],
      },
    });
    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/${bufferEntry.id}`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lines[0]).toMatchObject({
      barcode: 'BC-NONE',
      productName: 'BC-NONE',
      variantId: null,
      thumbUrl: null,
      stockCode: null,
    });
  });

  it('404 when the buffer entry does not exist for this store', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const store = await createStore(org.id);
    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/live-performance/buffer/00000000-0000-0000-0000-000000000000`,
      { headers: { Authorization: bearer(user.accessToken) } },
    );
    expect(res.status).toBe(404);
  });
});
