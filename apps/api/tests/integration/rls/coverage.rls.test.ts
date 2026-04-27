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
});
