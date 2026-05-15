// RLS contract for marketplace_commission_rate.
//
// The table is platform-scoped reference data (NOT tenant-private) — Trendyol's
// commission tariff is identical for every seller, so all authenticated users
// read the same global row set. The "tenant isolation" angle here is therefore
// inverted compared to other org-scoped tables: the policy MUST allow any
// authenticated user to read, and MUST deny client-initiated writes (writes go
// through the API on the service-role connection that bypasses RLS).

import { randomUUID } from 'node:crypto';

import { Decimal } from 'decimal.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('marketplace_commission_rate: RLS contract', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // ─── Case 1: SELECT is open to any authenticated user ─────────────────────

  it('any authenticated user can SELECT a commission rate row', async () => {
    const { user, client } = await createRlsScopedClient();
    // Create an org + membership so the JWT carries a valid org context, even
    // though the policy itself doesn't gate on org. Mirrors the actual
    // production session shape.
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const rate = await prisma.marketplaceCommissionRate.create({
      data: {
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

    const { data, error } = await client
      .from('marketplace_commission_rate')
      .select('*')
      .eq('id', rate.id);

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.category_name).toBe('Casual Ayakkabı');
  });

  // ─── Case 2: Two unrelated users see the same row ─────────────────────────
  //
  // Reinforces that this is shared reference data, not tenant-private: two
  // users in different organizations both read the same row.

  it('two users in different orgs both read the same global row', async () => {
    const a = await createRlsScopedClient();
    const orgA = await createOrganization();
    await createMembership(orgA.id, a.user.id);

    const b = await createRlsScopedClient();
    const orgB = await createOrganization();
    await createMembership(orgB.id, b.user.id);

    const rate = await prisma.marketplaceCommissionRate.create({
      data: {
        platform: 'TRENDYOL',
        ruleKind: 'CATEGORY',
        categoryId: BigInt(412),
        brandId: null,
        categoryName: 'Spor Ayakkabı',
        parentCategoryName: 'Günlük Ayakkabı',
        brandName: null,
        baseRate: new Decimal('7.00'),
        paymentTermDays: 60,
        segmentOverrides: {},
        fetchedAt: new Date(),
        sourceScreen: 'CategoryCommissionPaymentTerms',
      },
    });

    const ra = await a.client.from('marketplace_commission_rate').select('id').eq('id', rate.id);
    const rb = await b.client.from('marketplace_commission_rate').select('id').eq('id', rate.id);

    expect(ra.data?.length).toBe(1);
    expect(rb.data?.length).toBe(1);
  });

  // ─── Case 3: client-initiated INSERT is blocked ───────────────────────────
  //
  // Writes go through the API on the service-role connection which bypasses
  // RLS. There is no INSERT policy for `authenticated`, so PostgREST refuses.
  // This prevents a logged-in user from corrupting the shared tariff.

  it('authenticated user cannot INSERT a commission rate via the Supabase client', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    const { error } = await client.from('marketplace_commission_rate').insert({
      id: randomUUID(),
      platform: 'TRENDYOL',
      rule_kind: 'CATEGORY',
      category_id: 999,
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
});
