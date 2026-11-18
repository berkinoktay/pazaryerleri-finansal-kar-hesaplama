// The upload quota's queries against the real tables, inside a transaction as the
// import runs them: the stored bytes of a store over all six workbook parent tables,
// never another organization's or a sibling store's, and the two limits.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@pazarsync/db';

import { WorkbookConflictError } from '@/lib/errors';
import type { StoreScope } from '@/workbooks/adapter';
import {
  assertUploadQuota,
  storedUploadBytes,
  storedUploadBytesSql,
  WORKBOOK_PARENT_TABLES,
} from '@/workbooks/upload-quota';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore } from '../../helpers/factories';

// A distinct byte length per table, so a table the sum misses changes the total.
const BYTES_PER_TABLE = {
  commission_tariffs: 11,
  plus_commission_tariffs: 23,
  advantage_tariffs: 37,
  flash_product_lists: 41,
  discount_lists: 53,
  marketplace_campaign_lists: 67,
} as const;
const TOTAL_BYTES = Object.values(BYTES_PER_TABLE).reduce((sum, n) => sum + n, 0);

const LIMITS = { maxLists: 3, maxBytes: 1000 } as const;

function bytes(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(1);
}

/** One parent row per table for `scope`, each with its table's byte length. */
async function seedEveryTable(scope: StoreScope): Promise<void> {
  const base = { ...scope, name: 'Seeded' };
  await prisma.commissionTariff.create({
    data: { ...base, sourceFile: bytes(BYTES_PER_TABLE.commission_tariffs) },
  });
  await prisma.plusCommissionTariff.create({
    data: { ...base, sourceFile: bytes(BYTES_PER_TABLE.plus_commission_tariffs) },
  });
  await prisma.advantageTariff.create({
    data: { ...base, sourceFile: bytes(BYTES_PER_TABLE.advantage_tariffs) },
  });
  await prisma.flashProductList.create({
    data: { ...base, sourceFile: bytes(BYTES_PER_TABLE.flash_product_lists) },
  });
  await prisma.discountList.create({
    data: {
      ...base,
      discountType: 'NET',
      sourceFile: bytes(BYTES_PER_TABLE.discount_lists),
    },
  });
  await prisma.marketplaceCampaignList.create({
    data: {
      ...base,
      discountType: 'NET',
      sourceFile: bytes(BYTES_PER_TABLE.marketplace_campaign_lists),
    },
  });
}

/** One discount list holding `length` stored bytes. */
async function seedDiscountBytes(scope: StoreScope, length: number): Promise<void> {
  await prisma.discountList.create({
    data: { ...scope, name: 'Seeded', discountType: 'NET', sourceFile: bytes(length) },
  });
}

async function newScope(organizationId?: string): Promise<StoreScope> {
  const orgId = organizationId ?? (await createOrganization()).id;
  const store = await createStore(orgId);
  return { organizationId: orgId, storeId: store.id };
}

function storedBytes(scope: StoreScope): Promise<number> {
  return prisma.$transaction((tx) => storedUploadBytes(tx, scope));
}

async function quotaReason(
  scope: StoreScope,
  input: { listCount: number; incomingBytes: number },
): Promise<string | null> {
  try {
    await prisma.$transaction((tx) => assertUploadQuota(tx, scope, input, LIMITS));
    return null;
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.reason;
    throw err;
  }
}

/** The meta of the quota refusal, or null when the quota passes. */
async function quotaMeta(
  scope: StoreScope,
  input: { listCount: number; incomingBytes: number },
): Promise<Readonly<Record<string, string | number>> | null> {
  try {
    await prisma.$transaction((tx) => assertUploadQuota(tx, scope, input, LIMITS));
    return null;
  } catch (err) {
    if (err instanceof WorkbookConflictError) return err.meta;
    throw err;
  }
}

describe('storedUploadBytes', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('sums the stored source bytes of every workbook table of the store', async () => {
    const scope = await newScope();
    await seedEveryTable(scope);

    expect(await storedBytes(scope)).toBe(TOTAL_BYTES);
  });

  it('is 0 for a store with no stored file', async () => {
    expect(await storedBytes(await newScope())).toBe(0);
  });

  it("never counts another organization's or a sibling store's rows, in any table", async () => {
    const scope = await newScope();
    const sibling = await newScope(scope.organizationId);
    const foreign = await newScope();
    await seedEveryTable(scope);
    await seedEveryTable(sibling);
    await seedEveryTable(foreign);

    expect(await storedBytes(scope)).toBe(TOTAL_BYTES);
    expect(await storedBytes(sibling)).toBe(TOTAL_BYTES);
    expect(await storedBytes(foreign)).toBe(TOTAL_BYTES);
  });

  it('names exactly the six workbook parent tables in its query', () => {
    const sql = storedUploadBytesSql({ organizationId: 'org', storeId: 'store' }).sql;
    const tables = [...sql.matchAll(/FROM "([a-z_]+)"/g)].map((match) => match[1]);

    expect(tables).toEqual([...WORKBOOK_PARENT_TABLES]);
  });
});

describe('assertUploadQuota', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('passes a file that fills the byte limit exactly', async () => {
    const scope = await newScope();
    await seedDiscountBytes(scope, 900);

    expect(await quotaReason(scope, { listCount: 1, incomingBytes: 100 })).toBeNull();
  });

  it('refuses the file that would cross the byte limit', async () => {
    const scope = await newScope();
    await seedDiscountBytes(scope, 900);

    expect(await quotaReason(scope, { listCount: 1, incomingBytes: 101 })).toBe(
      'UPLOAD_QUOTA_EXCEEDED',
    );
    expect(await quotaMeta(scope, { listCount: 1, incomingBytes: 101 })).toEqual({
      limit: 'bytes',
      maxBytes: LIMITS.maxBytes,
    });
  });

  it('refuses a list once the page holds the maximum number of lists', async () => {
    const scope = await newScope();

    expect(await quotaReason(scope, { listCount: LIMITS.maxLists, incomingBytes: 1 })).toBe(
      'UPLOAD_QUOTA_EXCEEDED',
    );
    expect(await quotaMeta(scope, { listCount: LIMITS.maxLists, incomingBytes: 1 })).toEqual({
      limit: 'lists',
      maxLists: LIMITS.maxLists,
    });
    expect(
      await quotaReason(scope, { listCount: LIMITS.maxLists - 1, incomingBytes: 1 }),
    ).toBeNull();
  });

  it("does not count another store's bytes", async () => {
    const scope = await newScope();
    await seedDiscountBytes(scope, 900);
    await seedDiscountBytes(await newScope(scope.organizationId), 5000);
    await seedDiscountBytes(await newScope(), 5000);

    expect(await quotaReason(scope, { listCount: 1, incomingBytes: 100 })).toBeNull();
  });
});
