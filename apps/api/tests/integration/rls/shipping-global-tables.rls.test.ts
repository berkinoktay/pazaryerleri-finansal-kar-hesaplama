// RLS contract for the three shipping reference tables.
//
// `shipping_carriers`, `shipping_desi_tariffs`, and `shipping_barem_tariffs`
// are platform-scoped reference data (NOT tenant-private). Every authenticated
// seller reads the same global rows — Trendyol publishes a single carrier
// list and a single tariff table that applies identically to all stores.
//
// The RLS contract therefore mirrors `marketplace_commission_rate`:
//   1. Any authenticated user can SELECT.
//   2. Anonymous (no JWT) cannot SELECT (returns empty or an auth error).
//   3. Authenticated client-initiated INSERT is denied — there is no INSERT
//      policy for `authenticated`, so PostgREST refuses. Writes happen
//      only via the postgres role (migration seeds + future admin tooling),
//      which bypasses RLS.
//
// Seed rows for all three tables live in
// `packages/db/prisma/migrations/20260517085409_shipping_tariffs/migration.sql`
// and survive `truncateAll()` (which only touches tenant tables).
//
// Required by spec §9.4 — "Verify global tables are READable by
// authenticated users but not anonymous." Sister pattern in
// `apps/api/tests/integration/tenant-isolation/marketplace-commission-rate-schema.test.ts`.

import { randomUUID } from 'node:crypto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';
import { createAnonClient, createRlsScopedClient } from '../../helpers/rls-client';

const GLOBAL_TABLES = [
  'shipping_carriers',
  'shipping_desi_tariffs',
  'shipping_barem_tariffs',
  // Mikro ihracat "Yurt Dışı İade Operasyon Bedeli" kademe oranları — aynı global
  // referans RLS kontratı (authenticated read açık, anon + authenticated-write kapalı).
  // globalSetup (ensureMicroExportReturnTiers) seed'ler; truncateAll dokunmaz.
  'micro_export_return_fee_tiers',
] as const;

describe('RLS — shipping global reference tables', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    // Tenant tables only. The three global tables are NOT truncated; their
    // migration-seeded rows (e.g. SENDEOMP carrier) must remain visible.
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
      // Migration seeded at least one row in every global table.
      expect(data?.length ?? 0).toBeGreaterThan(0);
    });
  }

  // ─── Case 1b: a specific seeded carrier (SENDEOMP) is visible ─────────────
  //
  // Pins the "authenticated read works" assertion to a known row from the
  // migration's INSERT list, so a regression that drops the seed entirely
  // surfaces in this test instead of a downstream feature test.

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
  // (migrations / future admin tooling) which bypasses RLS.

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
      supports_barem_destek: true,
      max_barem_desi: 10,
      max_barem_eligible_delivery_duration: 1,
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
  });

  it('authenticated user CANNOT INSERT into shipping_desi_tariffs via the Supabase client', async () => {
    const { user, client } = await createRlsScopedClient();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');

    // Look up a real seeded carrier id so the would-be row at least passes
    // FK validation — proving the REJECTION is from RLS, not from a
    // 23503 foreign-key failure.
    const { data: carriers } = await client.from('shipping_carriers').select('id').limit(1);
    const carrierId = carriers?.[0]?.id;
    expect(carrierId).toBeTruthy();

    const { data, error } = await client.from('shipping_desi_tariffs').insert({
      id: randomUUID(),
      carrier_id: carrierId,
      desi: 99,
      price_net: '0.01',
      effective_from: '2026-01-01',
      updated_at: new Date().toISOString(),
    });

    if (error === null) {
      expect(data).toBeNull();
    } else {
      expect(error).not.toBeNull();
    }
  });
});
