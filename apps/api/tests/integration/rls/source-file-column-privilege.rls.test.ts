import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMemberStoreAccess,
  createMembership,
  createOrganization,
  createStore,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

/**
 * The six campaign parent tables keep the seller's raw uploaded .xlsx in
 * `source_file`. rls-policies.sql withholds that column from `authenticated`
 * (table-level SELECT revoked, every other column granted back), so a member
 * who can see the row, VIEWER included, still cannot pull the bytes through
 * PostgREST. The row-visible assertion proves the 42501 comes from the column
 * privilege and not from RLS hiding the row.
 */

// Non-empty stand-in for a stored workbook (ZIP local-file-header magic).
const SOURCE_FILE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

interface SeedScope {
  readonly organizationId: string;
  readonly storeId: string;
}

interface ParentTableCase {
  readonly table: string;
  readonly seed: (scope: SeedScope) => Promise<{ readonly id: string }>;
}

// Seeded via Prisma (postgres role bypasses RLS and column privileges).
const PARENT_TABLES: readonly ParentTableCase[] = [
  {
    table: 'commission_tariffs',
    seed: (scope) =>
      prisma.commissionTariff.create({
        data: { ...scope, name: 'Commission tariff', sourceFile: SOURCE_FILE },
      }),
  },
  {
    table: 'plus_commission_tariffs',
    seed: (scope) =>
      prisma.plusCommissionTariff.create({
        data: { ...scope, name: 'Plus tariff', sourceFile: SOURCE_FILE },
      }),
  },
  {
    table: 'advantage_tariffs',
    seed: (scope) =>
      prisma.advantageTariff.create({
        data: { ...scope, name: 'Advantage tariff', sourceFile: SOURCE_FILE },
      }),
  },
  {
    table: 'flash_product_lists',
    seed: (scope) =>
      prisma.flashProductList.create({
        data: { ...scope, name: 'Flash list', sourceFile: SOURCE_FILE },
      }),
  },
  {
    table: 'discount_lists',
    seed: (scope) =>
      prisma.discountList.create({
        data: { ...scope, name: 'Discount list', discountType: 'NET', sourceFile: SOURCE_FILE },
      }),
  },
  {
    table: 'marketplace_campaign_lists',
    seed: (scope) =>
      prisma.marketplaceCampaignList.create({
        data: { ...scope, name: 'Campaign list', discountType: 'NET', sourceFile: SOURCE_FILE },
      }),
  },
];

describe('RLS: source_file column privilege on campaign parent tables', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it.each(PARENT_TABLES)(
    '$table: a store VIEWER reads the row but not source_file',
    async ({ table, seed }) => {
      const { user, client } = await createRlsScopedClient();
      const org = await createOrganization();
      const store = await createStore(org.id);
      const member = await createMembership(org.id, user.id, 'VIEWER');
      await createMemberStoreAccess(org.id, member.id, store.id);
      const row = await seed({ organizationId: org.id, storeId: store.id });

      const visible = await client.from(table).select('id');
      expect(visible.error).toBeNull();
      expect(visible.data?.map((r) => r.id)).toEqual([row.id]);

      const raw = await client.from(table).select('source_file');
      expect(raw.data).toBeNull();
      expect(raw.error?.code).toBe('42501');

      const wildcard = await client.from(table).select('*');
      expect(wildcard.data).toBeNull();
      expect(wildcard.error?.code).toBe('42501');
    },
  );
});
