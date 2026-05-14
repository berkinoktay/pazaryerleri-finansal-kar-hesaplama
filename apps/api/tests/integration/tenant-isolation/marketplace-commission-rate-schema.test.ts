// Multi-tenancy RLS isolation for the marketplace_commission_rate table.
// Same shape as cost-profiles-schema.test.ts — exercises the schema layer
// through createRlsScopedClient() (PostgREST + real Supabase JWT) so the
// authenticated-role policy actually executes. Writes are API-only (service
// role bypasses RLS via DATABASE_URL), so the only thing under test here is
// the SELECT policy + the absence of an INSERT policy for authenticated.

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('marketplace_commission_rate: RLS isolation', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Case 1: SELECT isolation ─────────────────────────────────────────

  it("Org A user cannot SELECT Org B's commission rate row", async () => {
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

    const orgBRate = await prisma.marketplaceCommissionRate.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        platform: 'TRENDYOL',
        ruleKind: 'CATEGORY',
        categoryId: BigInt(411),
        brandId: null,
        categoryName: 'Casual Ayakkabı',
        parentCategoryName: 'Günlük Ayakkabı',
        brandName: null,
        baseRate: new Decimal('8.00'),
        paymentTermDays: 60,
        segmentOverrides: { ka2: '7.50' },
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });

    const { data, error } = await clientA
      .from('marketplace_commission_rate')
      .select('*')
      .eq('id', orgBRate.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ─── Case 2: INSERT cross-org blocked ─────────────────────────────────

  it('Org A user cannot INSERT a commission rate with Org B organization_id', async () => {
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

    // No INSERT policy exists for `authenticated` — all client-initiated
    // writes default-deny regardless of which org they target. PostgREST
    // surfaces this as 42501 or a PGRST-prefixed code.
    const { error } = await clientA.from('marketplace_commission_rate').insert({
      id: randomUUID(),
      organization_id: orgB.id,
      store_id: storeB.id,
      platform: 'TRENDYOL',
      rule_kind: 'CATEGORY',
      category_id: 411,
      category_name: 'sneaky insert',
      base_rate: '8.00',
      payment_term_days: 60,
      segment_overrides: {},
      fetched_at: new Date().toISOString(),
      source_screen: 'CategoryCommissionPaymentTerms',
      updated_at: new Date().toISOString(),
    });

    expect(error).not.toBeNull();
    expect(error?.code).toMatch(/42501|PGRST/);
  });

  // ─── Case 3: positive — own org's rate is readable ────────────────────

  it("Org A user CAN SELECT their own org's commission rate row", async () => {
    const { user: userA, client: clientA } = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);

    const storeA = await prisma.store.create({
      data: {
        organizationId: orgA.id,
        name: 'Store A',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: randomUUID(),
        credentials: 'test-encrypted-blob',
      },
    });

    const ownRate = await prisma.marketplaceCommissionRate.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platform: 'TRENDYOL',
        ruleKind: 'CATEGORY_BRAND',
        categoryId: BigInt(411),
        brandId: BigInt(16),
        categoryName: 'Casual Ayakkabı',
        brandName: 'Reebok 10',
        baseRate: new Decimal('5.00'),
        paymentTermDays: 60,
        segmentOverrides: { ka2: '4.00' },
        fetchedAt: new Date(),
        sourceScreen: 'CommercialRatesByCategoryAndBrand',
      },
    });

    const { data, error } = await clientA
      .from('marketplace_commission_rate')
      .select('*')
      .eq('id', ownRate.id);

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.brand_name).toBe('Reebok 10');
  });
});
