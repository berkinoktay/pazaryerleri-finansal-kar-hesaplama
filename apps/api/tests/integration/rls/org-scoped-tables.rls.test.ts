import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — org-scoped tables', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  /**
   * Two-tenant fixture:
   *   userA is OWNER of orgA; userB is OWNER of orgB.
   *   Only userA authenticates (gets a scoped client). userB is just a
   *   profile row so orgB has a valid member — RLS verification runs
   *   from userA's perspective.
   */
  async function twoTenantsSetup() {
    const { user: userA, client } = await createRlsScopedClient();
    const userB = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([
      createStore(orgA.id, { name: 'A Store' }),
      createStore(orgB.id, { name: 'B Store' }),
    ]);
    return { userA, client, orgA, orgB, storeA, storeB };
  }

  it('stores: member sees only own org stores', async () => {
    const { client, storeA, storeB } = await twoTenantsSetup();

    const { data, error } = await client.from('stores').select('id,name');

    expect(error).toBeNull();
    expect(data?.map((s) => s.id)).toEqual([storeA.id]);
    expect(data?.map((s) => s.id)).not.toContain(storeB.id);
  });

  it('orders: member sees only own org orders', async () => {
    const { client, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const [orderA] = await Promise.all([
      createOrder(orgA.id, storeA.id),
      createOrder(orgB.id, storeB.id),
    ]);

    const { data, error } = await client.from('orders').select('id');

    expect(error).toBeNull();
    expect(data?.map((o) => o.id)).toEqual([orderA.id]);
  });

  it('products: member sees only own org products', async () => {
    const { client, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const [productA] = await Promise.all([
      prisma.product.create({
        data: {
          organizationId: orgA.id,
          storeId: storeA.id,
          platformContentId: BigInt(1001),
          productMainId: 'pm-a',
          title: 'Product A',
        },
      }),
      prisma.product.create({
        data: {
          organizationId: orgB.id,
          storeId: storeB.id,
          platformContentId: BigInt(1002),
          productMainId: 'pm-b',
          title: 'Product B',
        },
      }),
    ]);

    const { data, error } = await client.from('products').select('id,title');

    expect(error).toBeNull();
    expect(data?.map((p) => p.id)).toEqual([productA.id]);
  });

  it('product_variants: member sees only own org variants', async () => {
    const { client, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          organizationId: orgA.id,
          storeId: storeA.id,
          platformContentId: BigInt(2001),
          productMainId: 'pm-a',
          title: 'Product A',
        },
      }),
      prisma.product.create({
        data: {
          organizationId: orgB.id,
          storeId: storeB.id,
          platformContentId: BigInt(2002),
          productMainId: 'pm-b',
          title: 'Product B',
        },
      }),
    ]);
    const [variantA] = await Promise.all([
      prisma.productVariant.create({
        data: {
          organizationId: orgA.id,
          storeId: storeA.id,
          productId: productA.id,
          platformVariantId: BigInt(20010),
          barcode: 'bc-a',
          stockCode: 'sk-a',
          salePrice: '100.00',
          listPrice: '100.00',
        },
      }),
      prisma.productVariant.create({
        data: {
          organizationId: orgB.id,
          storeId: storeB.id,
          productId: productB.id,
          platformVariantId: BigInt(20020),
          barcode: 'bc-b',
          stockCode: 'sk-b',
          salePrice: '100.00',
          listPrice: '100.00',
        },
      }),
    ]);

    const { data, error } = await client.from('product_variants').select('id,barcode');

    expect(error).toBeNull();
    expect(data?.map((v) => v.id)).toEqual([variantA.id]);
  });

  it('product_images: member sees only own org images', async () => {
    const { client, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          organizationId: orgA.id,
          storeId: storeA.id,
          platformContentId: BigInt(3001),
          productMainId: 'pm-a',
          title: 'Product A',
        },
      }),
      prisma.product.create({
        data: {
          organizationId: orgB.id,
          storeId: storeB.id,
          platformContentId: BigInt(3002),
          productMainId: 'pm-b',
          title: 'Product B',
        },
      }),
    ]);
    const [imageA] = await Promise.all([
      prisma.productImage.create({
        data: {
          organizationId: orgA.id,
          productId: productA.id,
          url: 'https://cdn.example.com/a.jpg',
          position: 0,
        },
      }),
      prisma.productImage.create({
        data: {
          organizationId: orgB.id,
          productId: productB.id,
          url: 'https://cdn.example.com/b.jpg',
          position: 0,
        },
      }),
    ]);

    const { data, error } = await client.from('product_images').select('id,url');

    expect(error).toBeNull();
    expect(data?.map((i) => i.id)).toEqual([imageA.id]);
  });

  it('order_items: member sees only items of orders in own org', async () => {
    const { client, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const [orderA, orderB] = await Promise.all([
      createOrder(orgA.id, storeA.id),
      createOrder(orgB.id, storeB.id),
    ]);
    const [itemA] = await Promise.all([
      prisma.orderItem.create({
        data: {
          orderId: orderA.id,
          quantity: 1,
          unitPrice: '10',
          commissionRate: '10',
          commissionAmount: '1',
        },
      }),
      prisma.orderItem.create({
        data: {
          orderId: orderB.id,
          quantity: 1,
          unitPrice: '10',
          commissionRate: '10',
          commissionAmount: '1',
        },
      }),
    ]);

    const { data, error } = await client.from('order_items').select('id,order_id');

    expect(error).toBeNull();
    expect(data?.map((i) => i.id)).toEqual([itemA.id]);
  });

  it('expenses: member sees only own org expenses', async () => {
    const { client, orgA, orgB } = await twoTenantsSetup();
    const [expA] = await Promise.all([
      prisma.expense.create({
        data: {
          organizationId: orgA.id,
          category: 'ADVERTISING',
          amount: '100',
          date: new Date(),
        },
      }),
      prisma.expense.create({
        data: {
          organizationId: orgB.id,
          category: 'ADVERTISING',
          amount: '200',
          date: new Date(),
        },
      }),
    ]);

    const { data, error } = await client.from('expenses').select('id,amount');

    expect(error).toBeNull();
    expect(data?.map((e) => e.id)).toEqual([expA.id]);
  });
});
