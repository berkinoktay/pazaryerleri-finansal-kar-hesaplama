import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../../src/app';
import { _resetRateLimitStoreForTests } from '../../../src/middleware/rate-limit.middleware';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createCostProfile,
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../helpers/factories';
import { ensureFeeDefinitions } from '../../helpers/seed-fee-definitions';

const SUPPLIER_ID_A = '11111';
const SUPPLIER_ID_B = '22222';
const WEBHOOK_USER_A = 'pazarsync-aaaaaaaaaaaaaaaa';
const WEBHOOK_PASS_A = 'A'.repeat(43);
const WEBHOOK_USER_B = 'pazarsync-bbbbbbbbbbbbbbbb';
const WEBHOOK_PASS_B = 'B'.repeat(43);

const ORDER_DATE_MS = Date.UTC(2026, 4, 19);
const LAST_MODIFIED_MS = Date.UTC(2026, 4, 20);

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function makePayload(supplierId: number) {
  return {
    orderNumber: '11101228439',
    shipmentPackageId: 3734026895,
    status: 'Delivered',
    orderDate: ORDER_DATE_MS,
    lastModifiedDate: LAST_MODIFIED_MS,
    agreedDeliveryDate: Date.UTC(2026, 4, 21),
    fastDelivery: false,
    micro: false,
    packageGrossAmount: 120,
    supplierId,
    lines: [
      {
        lineId: 1,
        sellerId: supplierId,
        barcode: 'EAN13-T-001',
        quantity: 1,
        lineUnitPrice: 120,
        lineGrossAmount: 120,
        lineSellerDiscount: 0,
        vatRate: 20,
        commission: 10,
      },
    ],
    packageHistories: [{ status: 'Delivered', createdDate: LAST_MODIFIED_MS }],
  };
}

async function setupOrgStore(args: { supplierId: string; username: string; password: string }) {
  const user = await createUserProfile();
  const org = await createOrganization();
  await createMembership(org.id, user.id);

  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: `Store ${args.supplierId}`,
      platform: 'TRENDYOL',
      environment: 'PRODUCTION',
      externalAccountId: args.supplierId,
      credentials: encryptCredentials({
        supplierId: args.supplierId,
        apiKey: 'k',
        apiSecret: 's',
      }),
      webhookId: `wh-${args.supplierId}`,
      webhookSecret: encryptCredentials({
        username: args.username,
        password: args.password,
      }),
      webhookActiveAt: new Date(),
    },
  });

  // Seed a calculable variant for the webhook payload barcode so an order
  // that passes auth + supplier checks also clears the V1 calculability gate.
  const costProfile = await createCostProfile(org.id);
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: BigInt(Math.floor(Math.random() * 1_000_000)),
      productMainId: `pm-EAN13-T-001-${args.supplierId}`,
      title: 'Tenant Webhook Test Product',
    },
  });
  await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: BigInt(Math.floor(Math.random() * 1_000_000)),
      barcode: 'EAN13-T-001',
      stockCode: `sk-EAN13-T-001-${args.supplierId}`,
      salePrice: '100',
      listPrice: '120',
      costProfileLinks: { create: { organizationId: org.id, profileId: costProfile.id } },
    },
  });

  return { orgId: org.id, storeId: store.id };
}

const app = createApp();

describe('Tenant isolation — webhook receiver cross-store/cross-org safety', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    _resetRateLimitStoreForTests();
    await truncateAll();
    await ensureFeeDefinitions();
  });

  it('Store B credentials on Store A URL → 401 (credential mismatch)', async () => {
    const a = await setupOrgStore({
      supplierId: SUPPLIER_ID_A,
      username: WEBHOOK_USER_A,
      password: WEBHOOK_PASS_A,
    });
    await setupOrgStore({
      supplierId: SUPPLIER_ID_B,
      username: WEBHOOK_USER_B,
      password: WEBHOOK_PASS_B,
    });

    const res = await app.request(`/v1/webhooks/orders/${a.storeId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(WEBHOOK_USER_B, WEBHOOK_PASS_B),
      },
      body: JSON.stringify(makePayload(Number.parseInt(SUPPLIER_ID_A, 10))),
    });
    expect(res.status).toBe(401);
    // No webhook event row written for Store A
    expect(await prisma.webhookEvent.count({ where: { storeId: a.storeId } })).toBe(0);
  });

  it('Store A credentials on Store A URL but payload carries Store B supplierId → 401', async () => {
    const a = await setupOrgStore({
      supplierId: SUPPLIER_ID_A,
      username: WEBHOOK_USER_A,
      password: WEBHOOK_PASS_A,
    });

    const res = await app.request(`/v1/webhooks/orders/${a.storeId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(WEBHOOK_USER_A, WEBHOOK_PASS_A),
      },
      body: JSON.stringify(makePayload(Number.parseInt(SUPPLIER_ID_B, 10))),
    });
    expect(res.status).toBe(401);
    // Defense-in-depth supplierId check fires after credential validation;
    // no Order or WebhookEvent should be created.
    expect(await prisma.order.count({ where: { storeId: a.storeId } })).toBe(0);
    expect(await prisma.webhookEvent.count({ where: { storeId: a.storeId } })).toBe(0);
  });

  it('Webhook for Store A writes Order only under Org A — cross-org leak guard', async () => {
    const a = await setupOrgStore({
      supplierId: SUPPLIER_ID_A,
      username: WEBHOOK_USER_A,
      password: WEBHOOK_PASS_A,
    });
    const b = await setupOrgStore({
      supplierId: SUPPLIER_ID_B,
      username: WEBHOOK_USER_B,
      password: WEBHOOK_PASS_B,
    });

    const res = await app.request(`/v1/webhooks/orders/${a.storeId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: basicAuth(WEBHOOK_USER_A, WEBHOOK_PASS_A),
      },
      body: JSON.stringify(makePayload(Number.parseInt(SUPPLIER_ID_A, 10))),
    });
    expect(res.status).toBe(200);

    // Order written under Org A only
    const ordersA = await prisma.order.findMany({ where: { organizationId: a.orgId } });
    const ordersB = await prisma.order.findMany({ where: { organizationId: b.orgId } });
    expect(ordersA).toHaveLength(1);
    expect(ordersB).toHaveLength(0);

    // WebhookEvent also org-scoped
    const eventsA = await prisma.webhookEvent.findMany({ where: { organizationId: a.orgId } });
    const eventsB = await prisma.webhookEvent.findMany({ where: { organizationId: b.orgId } });
    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(0);
  });
});
