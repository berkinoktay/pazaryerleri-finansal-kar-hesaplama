import { prisma } from '@pazarsync/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureDbReachable } from '../../helpers/db';

/**
 * The full list of tenant-scoped tables. Every entry MUST have
 * `ENABLE ROW LEVEL SECURITY` and at least one SELECT policy. A
 * forgotten policy is a silent data leak; this guard is how we catch
 * it before PR review does.
 */
const TENANT_TABLES = [
  'user_profiles',
  'organizations',
  'organization_members',
  'stores',
  'products',
  'product_variants',
  'product_images',
  'orders',
  'order_items',
  'expenses',
  'settlements',
  'settlement_items',
  'sync_logs',
  'own_shipping_tariffs',
  // Saved commission tariffs (store-scoped campaign price-band tariffs)
  'commission_tariffs',
  'commission_tariff_periods',
  'commission_tariff_items',
  // Saved Plus commission tariffs (store-scoped Trendyol Plus offer)
  'plus_commission_tariffs',
  'plus_commission_tariff_periods',
  'plus_commission_tariff_items',
  // Saved Advantage Label tariffs (store-scoped Trendyol "Avantajlı Ürün Etiketleri")
  'advantage_tariffs',
  'advantage_tariff_items',
  // Saved Flash Products lists (store-scoped Trendyol "Flaş Ürünler")
  'flash_product_lists',
  'flash_product_items',
  // Profit Calculation V1 (PR-1)
  'order_fees',
  'order_claims',
  'order_claim_items',
  'org_period_fees',
  'commission_invoices',
  // Trendyol webhook receiver (PR-C1)
  'webhook_events',
  // Member ↔ store access grants (member/org/store access-control)
  'member_store_access',
  // Live Performance buffer (Spec 2 PR-A)
  'live_performance_buffer',
  // Catalog barcode gap tracking (catalog-barcode-vendor-miss)
  'catalog_barcode_miss',
  // Fiyat yazma denetim kaydı (trendyol-price-write)
  'price_change_logs',
] as const;

describe('RLS — coverage', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('every tenant table has RLS enabled', async () => {
    const rows = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT relname, relrowsecurity
        FROM pg_class
       WHERE relname = ANY(${TENANT_TABLES as unknown as string[]}::text[])
         AND relkind = 'r'
    `;

    const lookup = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const table of TENANT_TABLES) {
      expect(lookup.get(table), `${table} should exist and have RLS enabled`).toBe(true);
    }
  });

  it('every tenant table has at least one SELECT policy', async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string; count: bigint }>>`
      SELECT tablename, COUNT(*)::bigint AS count
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = ANY(${TENANT_TABLES as unknown as string[]}::text[])
         AND (cmd = 'SELECT' OR cmd = 'ALL')
       GROUP BY tablename
    `;

    const lookup = new Map(rows.map((r) => [r.tablename, Number(r.count)]));
    for (const table of TENANT_TABLES) {
      expect(
        lookup.get(table) ?? 0,
        `${table} should have at least one SELECT policy`,
      ).toBeGreaterThan(0);
    }
  });

  // Defense against the "forgot to add an RLS policy for a new table" footgun.
  // The GRANT baseline (rls-policies.sql) hands `authenticated` DML on ALL public
  // tables plus ALTER DEFAULT PRIVILEGES for future ones, so RLS default-deny only
  // protects a table where RLS was actually enabled. A table that is neither
  // RLS-protected NOR revoked is fully cross-tenant readable via PostgREST. This
  // is allowlist-free on purpose: instead of enumerating exempt tables, we assert
  // the real invariant — a table is safe iff RLS is on OR `authenticated` cannot
  // read it. `_prisma_migrations` (present in prod via `prisma migrate deploy`,
  // usually absent in db:push dev) is the concrete case: it has no RLS, so it MUST
  // be REVOKE-d (see the DO block in rls-policies.sql).
  it('no public base table is readable by `authenticated` without RLS', async () => {
    const rows = await prisma.$queryRaw<Array<{ relname: string; readable: boolean }>>`
      SELECT c.relname,
             has_table_privilege('authenticated', c.oid, 'SELECT') AS readable
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relkind = 'r'
         AND c.relrowsecurity = false
    `;

    const leaky = rows.filter((r) => r.readable).map((r) => r.relname);
    expect(
      leaky,
      `public tables with RLS disabled AND still readable by authenticated — ` +
        `either enable RLS + add a SELECT policy, or REVOKE the grant: ${leaky.join(', ')}`,
    ).toEqual([]);
  });

  // SECURITY DEFINER maintenance functions must not be client-invokable via
  // PostgREST RPC. reset_live_performance_buffer() runs a cross-org DELETE as
  // postgres and is pg_cron-only; Postgres grants EXECUTE to PUBLIC by default,
  // so db-functions.sql must REVOKE it. (is_org_member/can_access_store are
  // deliberately NOT revoked — RLS policy evaluation for `authenticated` needs
  // EXECUTE on them, and they only answer about the caller's own auth.uid().)
  it('reset_live_performance_buffer() is not EXECUTE-able by `authenticated`', async () => {
    const rows = await prisma.$queryRaw<Array<{ authExec: boolean }>>`
      SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS "authExec"
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'reset_live_performance_buffer'
    `;

    expect(rows.length, 'reset_live_performance_buffer() should exist').toBeGreaterThan(0);
    for (const r of rows) {
      expect(
        r.authExec,
        'reset_live_performance_buffer() must not be EXECUTE-able by authenticated',
      ).toBe(false);
    }
  });
});
