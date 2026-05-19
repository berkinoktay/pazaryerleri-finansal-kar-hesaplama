// Multi-tenancy RLS isolation for cost-profile tables introduced in Task 1.3.
// These tests exercise the schema layer directly — no Hono app, no API
// endpoints — because the cost-profile CRUD API (PR 2) does not exist yet.
// Queries run through createRlsScopedClient(), which builds a PostgREST
// client scoped to a real Supabase JWT (`authenticated` role), so RLS
// policies actually execute.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('cost-profile tables: RLS isolation', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
    // fx_rates is not org-scoped so truncateAll (which cascades from
    // organizations) does not touch it. Clean it explicitly so each test
    // starts with a predictable empty fx_rates table.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE fx_rates RESTART IDENTITY CASCADE');
  });

  // ─── Case 1: cost_profiles SELECT isolation ──────────────────────────

  it("Org A user cannot SELECT Org B's cost_profile", async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();

    const orgBProfile = await prisma.costProfile.create({
      data: {
        organizationId: orgB.id,
        name: 'Org B COGS',
        type: 'COGS',
        amount: new Decimal('10.00'),
        currency: 'TRY',
        vatRate: 18,
        fxRateMode: 'AUTO',
      },
    });

    const { data, error } = await clientA
      .from('cost_profiles')
      .select('*')
      .eq('id', orgBProfile.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ─── Case 2: cost_profiles INSERT cross-org blocked ──────────────────

  it('Org A user cannot INSERT a cost_profile with Org B organization_id', async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const orgB = await createOrganization();

    // No INSERT policy exists for `authenticated` on cost_profiles — all
    // client-initiated inserts default-deny regardless of the org they
    // target. PostgREST surfaces this as a 42501 SQLSTATE or a PGRST-prefixed
    // error code.
    const { error } = await clientA.from('cost_profiles').insert({
      organization_id: orgB.id,
      name: 'sneaky insert',
      type: 'COGS',
      amount: '10.00',
      currency: 'TRY',
      vat_rate: 0,
      fx_rate_mode: 'AUTO',
    });

    expect(error).not.toBeNull();
    expect(error?.code).toMatch(/42501|PGRST/);
  });

  // ─── Case 3: product_variant_cost_profiles SELECT isolation ──────────

  it("Org A user cannot SELECT Org B's product_variant_cost_profiles row", async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();

    // Seed Org B: store → product → variant → cost_profile → link
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: randomUUID(),
        credentials: 'test-encrypted-blob',
      },
    });

    const productB = await prisma.product.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        platformContentId: BigInt(90001),
        productMainId: 'PB',
        title: 'Product B',
      },
    });

    const variantB = await prisma.productVariant.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        productId: productB.id,
        platformVariantId: BigInt(91001),
        barcode: 'BARCODE-B',
        stockCode: 'SKU-B',
        salePrice: '50.00',
        listPrice: '60.00',
      },
    });

    const profileB = await prisma.costProfile.create({
      data: {
        organizationId: orgB.id,
        name: 'Org B COGS variant',
        type: 'COGS',
        amount: new Decimal('5.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
      },
    });

    const link = await prisma.productVariantCostProfile.create({
      data: {
        organizationId: orgB.id,
        productVariantId: variantB.id,
        profileId: profileB.id,
      },
    });

    const { data, error } = await clientA
      .from('product_variant_cost_profiles')
      .select('*')
      .eq('id', link.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ─── Case 4: order_item_cost_snapshot_components SELECT isolation ────

  it("Org A user cannot SELECT Org B's order_item_cost_snapshot_components row", async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();

    // Seed Org B: store → order → order_item → cost_profile → snapshot component
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: randomUUID(),
        credentials: 'test-encrypted-blob',
      },
    });

    const orderB = await prisma.order.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        platformOrderId: `order-b-${randomUUID().slice(0, 8)}`,
        orderDate: new Date(),
        status: 'DELIVERED',
      },
    });

    const orderItemB = await prisma.orderItem.create({
      data: {
        orderId: orderB.id,
        organizationId: orgB.id,
        quantity: 1,
        unitPrice: '100.00',
        commissionRate: '20.00',
        commissionAmount: '20.00',
        unitCostSnapshot: '15.00',
        snapshotCapturedAt: new Date(),
      },
    });

    const profileB = await prisma.costProfile.create({
      data: {
        organizationId: orgB.id,
        name: 'Org B COGS snapshot',
        type: 'COGS',
        amount: new Decimal('15.00'),
        currency: 'TRY',
        vatRate: 0,
        fxRateMode: 'AUTO',
      },
    });

    const snapshot = await prisma.orderItemCostSnapshotComponent.create({
      data: {
        orderItemId: orderItemB.id,
        organizationId: orgB.id,
        profileId: profileB.id,
        profileName: 'Org B COGS snapshot',
        profileType: 'COGS',
        amount: new Decimal('15.00'),
        currency: 'TRY',
        vatRate: 0,
        amountInTry: new Decimal('15.00'),
        fxRateMode: 'AUTO',
        fxRateUsed: new Decimal('1.000000'),
        fxRateSource: 'FIXED',
      },
    });

    const { data, error } = await clientA
      .from('order_item_cost_snapshot_components')
      .select('*')
      .eq('id', snapshot.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ─── Case 5: fx_rates globally readable ──────────────────────────────

  it('fx_rates is globally readable for any authenticated user', async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    await prisma.fxRate.create({
      data: {
        currency: 'USD',
        rateDate: new Date('2026-05-09'),
        rateToTry: new Decimal('35.50'),
        source: 'TCMB',
      },
    });

    const { data, error } = await clientA.from('fx_rates').select('*');

    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThan(0);
  });
});
