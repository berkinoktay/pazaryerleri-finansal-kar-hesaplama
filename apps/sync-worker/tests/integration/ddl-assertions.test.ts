// Boot-time DDL guard: the correctness-critical schema that lives only in
// supabase/sql (NOT in Prisma migrations) must exist in a properly bootstrapped
// database. assertCriticalDdl is the worker's fail-fast boot check; a DB missing
// any of it silently loses duplicate-job protection / fee idempotency (wrong
// profit numbers, no error) OR drops the frontend's realtime surfaces (REST
// works, channel SUBSCRIBED, zero events).
//
// It verifies three categories:
//   - partial unique indexes           (assertIndexesExist)
//   - supabase_realtime table members  (assertPublicationTablesExist)
//   - publication INSERT/UPDATE flags   (covered by the full-check positive path)
//
// Both negative paths use a FABRICATED name against the same shared test schema
// -- we never drop a real index or mutate the real publication to prove the
// failure. This exercises the parameterized checkers directly.
//
// Requires `pnpm db:push` / `pnpm db:test-setup` (chains apply-policies ->
// check-constraints.sql + realtime-publications.sql) against the local Supabase
// before running -- same prerequisite as every other integration suite.

import { beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import {
  assertCriticalDdl,
  assertIndexesExist,
  assertPublicationTablesExist,
  MissingCriticalDdlError,
  REQUIRED_INDEXES,
  REQUIRED_PUBLICATION_TABLES,
} from '../../src/lib/ddl-assertions';
import { ensureDbReachable } from '../../../../apps/api/tests/helpers/db';

describe('assertCriticalDdl (boot-time DDL guard)', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('resolves against a properly bootstrapped database (indexes + publication tables + publication flags present)', async () => {
    await expect(assertCriticalDdl(prisma)).resolves.toBeUndefined();
  });

  describe('partial unique indexes', () => {
    it('throws MissingCriticalDdlError naming the missing index when one is absent', async () => {
      const bogus = 'sync_logs_definitely_not_a_real_index_xyz';
      await expect(assertIndexesExist(prisma, [bogus])).rejects.toBeInstanceOf(
        MissingCriticalDdlError,
      );
      await expect(assertIndexesExist(prisma, [bogus])).rejects.toMatchObject({
        missing: [bogus],
      });
    });

    it('reports only the genuinely-missing names, not the ones that exist', async () => {
      const bogus = 'order_fees_not_a_real_index_abc';
      // A mix of one real (present) index + one bogus name -> only the bogus name
      // is reported missing, proving the checker subtracts present from expected.
      await expect(assertIndexesExist(prisma, [REQUIRED_INDEXES[0], bogus])).rejects.toMatchObject({
        missing: [bogus],
      });
    });
  });

  describe('supabase_realtime publication tables', () => {
    it('throws MissingCriticalDdlError naming the missing table when one is not published', async () => {
      const bogus = 'not_a_published_table_xyz';
      await expect(assertPublicationTablesExist(prisma, [bogus])).rejects.toBeInstanceOf(
        MissingCriticalDdlError,
      );
      await expect(assertPublicationTablesExist(prisma, [bogus])).rejects.toMatchObject({
        missingPublicationTables: [bogus],
      });
    });

    it('reports only the genuinely-unpublished names, not the ones that are members', async () => {
      const bogus = 'not_a_published_table_abc';
      // A mix of one real (published) table + one bogus name -> only the bogus
      // name is reported missing, proving the checker subtracts present from expected.
      await expect(
        assertPublicationTablesExist(prisma, [REQUIRED_PUBLICATION_TABLES[0], bogus]),
      ).rejects.toMatchObject({
        missingPublicationTables: [bogus],
      });
    });
  });
});
