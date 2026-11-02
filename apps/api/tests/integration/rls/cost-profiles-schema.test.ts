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
  });

  // ─── Case 1: cost_profiles SELECT isolation ──────────────────────────

  it("Org A user cannot SELECT Org B's cost_profile", async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const orgB = await createOrganization();

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

    const orgBProfile = await prisma.costProfile.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        name: 'Org B COGS',
        type: 'COGS',
        amountGross: new Decimal('10.00'),
        vatRate: 18,
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
      amount_gross: '10.00',
      vat_rate: 0,
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
        storeId: storeB.id,
        name: 'Org B COGS variant',
        type: 'COGS',
        amountGross: new Decimal('5.00'),
        vatRate: 0,
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
});
