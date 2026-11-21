// RLS contract for the shipping and micro-export reference tables.
//
// The tables listed in GLOBAL_TABLES below (the carriers, their dated tariff
// versions with the desi and Barem rows, and the dated micro-export return fee
// tiers) are platform-scoped reference data (NOT tenant-private). Every
// authenticated seller reads the same global rows — Trendyol publishes a single
// carrier list and a single tariff table that applies identically to all stores.
//
// The RLS contract therefore mirrors `marketplace_commission_rate`:
//   1. Any authenticated user can SELECT.
//   2. Anonymous (no JWT) cannot SELECT (returns empty or an auth error).
//   3. Authenticated client-initiated INSERT is denied — there is no INSERT
//      policy for `authenticated`, so PostgREST refuses. Writes happen
//      only via the postgres role (the reference seed files + future admin
//      tooling), which bypasses RLS.
//
// Seed rows for the shipping tables live in
// `packages/db/prisma/reference-seed/20261121090000_shipping_tariff_versions.sql`
// and survive `truncateAll()` (which only touches tenant tables).
//
// Required by spec §9.4 — "Verify global tables are READable by
// authenticated users but not anonymous." Sister pattern in
// `apps/api/tests/integration/tenant-isolation/marketplace-commission-rate-schema.test.ts`.

import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';
import { Platform } from '@pazarsync/db/enums';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { createAnonClient, createRlsScopedClient } from '../../helpers/rls-client';

const GLOBAL_TABLES = [
  'shipping_carriers',
  'shipping_desi_tariffs',
  'shipping_barem_tariffs',
  // Micro-export return fee tiers: same global reference contract (authenticated
  // read open, anon and authenticated writes closed). The test setup loads them
  // from the reference seed (ensureMicroExportReturnTiers); truncateAll never touches them.
  'micro_export_return_fee_tiers',
  // Dated sets the tariff rows and the micro-export tiers belong to; same global
  // reference contract. The reference seed writes them together with their rows.
  'shipping_tariff_versions',
  'micro_export_return_fee_tier_versions',
] as const;

// Start of the versions the INSERT denial tests try to write. No seeded version
// starts here, and it differs from the 2099-01-01 starts other suites create, so
// with RLS off the insert would succeed and the read-back would catch it.
const SNEAKY_VERSION_START = new Date('2099-06-01T00:00:00.000Z');

describe('RLS — shipping global reference tables', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    // Tenant tables only. The shipping reference tables are NOT truncated; their
    // rows, written by the reference seed files (e.g. the SENDEOMP carrier), must
    // remain visible.
    await truncateAll();
  });

  // ─── Case 1: authenticated SELECT returns seeded rows ─────────────────────

  for (const table of GLOBAL_TABLES) {
    it(`authenticated user CAN SELECT from ${table}`, async () => {
      const { user, client } = await createRlsScopedClient();
      // Create org + membership so the JWT carries a real org context,
      // matching the production session shape (the policy itself is
      // `USING (true)` and does not gate on org).
      const org = await createOrganization();
      await createMembership(org.id, user.id, 'OWNER');

      const { data, error } = await client.from(table).select('id').limit(1);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      // The reference seed wrote at least one row in every global table.
      expect(data?.length ?? 0).toBeGreaterThan(0);
    });
  }

  // ─── Case 1b: a specific seeded carrier (SENDEOMP) is visible ─────────────
  //
  // Pins the "authenticated read works" assertion to a known row written by
  // the shipping reference seed file, so a regression that drops the seed
  // entirely surfaces in this test instead of a downstream feature test.

  it('authenticated user sees the seeded SENDEOMP carrier row', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');

    const { data, error } = await client
      .from('shipping_carriers')
      .select('id,code,display_name,platform')
      .eq('platform', 'TRENDYOL')
      .eq('code', 'SENDEOMP');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.display_name).toBe('Kolay Gelsin');
  });

  // ─── Case 2: anonymous SELECT returns no data (or an auth error) ──────────

  for (const table of GLOBAL_TABLES) {
    it(`anonymous (no JWT) CANNOT read ${table}`, async () => {
      const client = createAnonClient();

      const { data, error } = await client.from(table).select('id').limit(1);

      // Two acceptable shapes: PostgREST returns an auth/RLS error, OR the
      // policy filters all rows leaving an empty array. Both prove the row
      // is not visible without authentication.
      if (error === null) {
        expect(data).toEqual([]);
      } else {
        expect(error).not.toBeNull();
      }
    });
  }

  // ─── Case 3: authenticated INSERT is blocked ──────────────────────────────
  //
  // No INSERT policy exists for `authenticated`, so PostgREST refuses any
  // client-initiated write. Tariff content is owned by the postgres role
  // (the reference seed files / future admin tooling) which bypasses RLS.

  it('authenticated user CANNOT INSERT into shipping_carriers via the Supabase client', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');

    const { data, error } = await client.from('shipping_carriers').insert({
      id: randomUUID(),
      platform: 'TRENDYOL',
      external_id: 99999,
      code: 'SNEAKY',
      display_name: 'Sneaky Carrier',
      tax_number: '0000000000',
      sort_order: 999,
      active: true,
      updated_at: new Date().toISOString(),
    });

    // RLS denial surfaces either as a non-null error (42501 / PGRST) or as
    // a silently-filtered insert returning no data. Either way, no row is
    // persisted.
    if (error === null) {
      expect(data).toBeNull();
    } else {
      expect(error).not.toBeNull();
    }
    // The branches above also pass with RLS off, so read the table back through
    // the RLS-bypassing Prisma client: the row must not exist.
    const persisted = await prisma.shippingCarrier.count({
      where: { platform: Platform.TRENDYOL, code: 'SNEAKY' },
    });
    expect(persisted).toBe(0);
  });

  it('authenticated user CANNOT INSERT into shipping_desi_tariffs via the Supabase client', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');

    // Look up a real seeded tariff version id so the would-be row at least
    // passes FK validation — proving the REJECTION is from RLS, not from a
    // 23503 foreign-key failure.
    const { data: versions } = await client.from('shipping_tariff_versions').select('id').limit(1);
    const versionId: unknown = versions?.[0]?.id;
    expect(versionId).toBeTruthy();
    if (typeof versionId !== 'string') {
      throw new Error('Expected a seeded shipping tariff version id');
    }

    const { data, error } = await client.from('shipping_desi_tariffs').insert({
      id: randomUUID(),
      version_id: versionId,
      desi: 99,
      price_net: '0.01',
      updated_at: new Date().toISOString(),
    });

    if (error === null) {
      expect(data).toBeNull();
    } else {
      expect(error).not.toBeNull();
    }
    // As above: read back through the RLS-bypassing Prisma client.
    const persisted = await prisma.shippingDesiTariff.count({ where: { versionId, desi: 99 } });
    expect(persisted).toBe(0);
  });

  it('authenticated user CANNOT INSERT into shipping_tariff_versions via the Supabase client', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');

    // Look up the seeded SENDEOMP carrier id so the would-be row passes FK
    // validation — proving the REJECTION is from RLS, not from a 23503
    // foreign-key failure.
    const { data: carriers } = await client
      .from('shipping_carriers')
      .select('id')
      .eq('platform', 'TRENDYOL')
      .eq('code', 'SENDEOMP');
    const carrierId: unknown = carriers?.[0]?.id;
    expect(carrierId).toBeTruthy();
    if (typeof carrierId !== 'string') {
      throw new Error('Expected the seeded SENDEOMP carrier id');
    }

    const { data, error } = await client.from('shipping_tariff_versions').insert({
      id: randomUUID(),
      carrier_id: carrierId,
      effective_from: SNEAKY_VERSION_START.toISOString(),
      supports_barem_destek: false,
      max_barem_desi: 10,
      max_barem_eligible_delivery_duration: 1,
      updated_at: new Date().toISOString(),
    });

    if (error === null) {
      expect(data).toBeNull();
    } else {
      expect(error).not.toBeNull();
    }
    // As above: read back through the RLS-bypassing Prisma client.
    const persisted = await prisma.shippingTariffVersion.count({
      where: { carrierId, effectiveFrom: SNEAKY_VERSION_START },
    });
    expect(persisted).toBe(0);
  });

  it('authenticated user CANNOT INSERT into micro_export_return_fee_tier_versions via the Supabase client', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');

    const { data, error } = await client.from('micro_export_return_fee_tier_versions').insert({
      id: randomUUID(),
      effective_from: SNEAKY_VERSION_START.toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error === null) {
      expect(data).toBeNull();
    } else {
      expect(error).not.toBeNull();
    }
    // As above: read back through the RLS-bypassing Prisma client.
    const persisted = await prisma.microExportReturnFeeTierVersion.count({
      where: { effectiveFrom: SNEAKY_VERSION_START },
    });
    expect(persisted).toBe(0);
  });
});
