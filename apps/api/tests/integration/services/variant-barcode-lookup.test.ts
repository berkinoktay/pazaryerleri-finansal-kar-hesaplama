// Integration tests for the shared barcode -> variant lookup (resolveVariantIdsByBarcode),
// the single copy of the campaign pages' matching rule. They pin:
//
//   1. an exact barcode match scoped to the organization AND the store (another store of
//      the same org, another org, and a mismatched org/store pair never leak a variant);
//   2. one total order for duplicate barcodes: a listed variant (delistedAt null) beats a
//      delisted one, then the oldest createdAt wins, then the smallest id, so repeated
//      calls pick the same row;
//   3. the query budget: no query for an empty input, exactly one for many barcodes.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@pazarsync/db';

import { resolveVariantIdsByBarcode } from '@/lib/variant-barcode-lookup';

import { countingTransactionClient } from '../../helpers/counting-transaction-client';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../helpers/factories';

const DAY_MS = 24 * 60 * 60 * 1000;
const EXISTING_BARCODE_COUNT = 150;
const MISSING_BARCODE_COUNT = 150;

interface StoreFixture {
  organizationId: string;
  storeId: string;
  productId: string;
}

/** A store with one product, in the given organization (a new one when omitted). */
async function seedStore(organizationId?: string): Promise<StoreFixture> {
  const orgId = organizationId ?? (await createOrganization()).id;
  const store = await createStore(orgId);
  const product = await createProduct(orgId, store.id);
  return { organizationId: orgId, storeId: store.id, productId: product.id };
}

async function seedVariant(fixture: StoreFixture, barcode: string): Promise<string> {
  const variant = await createProductVariant(
    fixture.organizationId,
    fixture.storeId,
    fixture.productId,
    { barcode },
  );
  return variant.id;
}

/** Gives a freshly seeded variant (nothing references it yet) a chosen id. */
async function setVariantId(variantId: string, id: string): Promise<string> {
  await prisma.productVariant.update({ where: { id: variantId }, data: { id } });
  return id;
}

async function setVariantDates(
  variantId: string,
  dates: { createdAt: Date; delistedAt?: Date | null },
): Promise<void> {
  await prisma.productVariant.update({
    where: { id: variantId },
    data: { createdAt: dates.createdAt, delistedAt: dates.delistedAt ?? null },
  });
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function scopeOf(fixture: StoreFixture): { organizationId: string; storeId: string } {
  return { organizationId: fixture.organizationId, storeId: fixture.storeId };
}

describe('resolveVariantIdsByBarcode', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  describe('scope', () => {
    it('returns the variant id of a barcode in the org and store; a barcode with no variant is absent', async () => {
      const fixture = await seedStore();
      const variantId = await seedVariant(fixture, 'BC-HIT');

      const result = await resolveVariantIdsByBarcode(prisma, scopeOf(fixture), [
        'BC-HIT',
        'BC-MISSING',
      ]);

      expect(result.get('BC-HIT')).toBe(variantId);
      expect(result.has('BC-MISSING')).toBe(false);
      expect(result.size).toBe(1);
    });

    it('never returns a variant of another store of the same organization', async () => {
      const storeA = await seedStore();
      const storeB = await seedStore(storeA.organizationId);
      // Store B's variant is created first, so it is the older row with the shared barcode.
      const variantB = await seedVariant(storeB, 'BC-SHARED');
      await seedVariant(storeB, 'BC-ONLY-B');
      const variantA = await seedVariant(storeA, 'BC-SHARED');

      const resultA = await resolveVariantIdsByBarcode(prisma, scopeOf(storeA), [
        'BC-SHARED',
        'BC-ONLY-B',
      ]);
      expect(resultA.get('BC-SHARED')).toBe(variantA);
      expect(resultA.has('BC-ONLY-B')).toBe(false);
      expect(resultA.size).toBe(1);

      const resultB = await resolveVariantIdsByBarcode(prisma, scopeOf(storeB), ['BC-SHARED']);
      expect(resultB.get('BC-SHARED')).toBe(variantB);
    });

    it('never returns another organization variant, also for a mismatched org and store pair', async () => {
      const tenantA = await seedStore();
      const tenantB = await seedStore();
      const variantB = await seedVariant(tenantB, 'BC-TENANT');

      const own = await resolveVariantIdsByBarcode(prisma, scopeOf(tenantA), ['BC-TENANT']);
      expect(own.size).toBe(0);

      const mismatched = await resolveVariantIdsByBarcode(
        prisma,
        { organizationId: tenantA.organizationId, storeId: tenantB.storeId },
        ['BC-TENANT'],
      );
      expect(mismatched.size).toBe(0);

      // Sanity: the variant is found in its own tenant, so the empty maps above are the scope.
      const theirs = await resolveVariantIdsByBarcode(prisma, scopeOf(tenantB), ['BC-TENANT']);
      expect(theirs.get('BC-TENANT')).toBe(variantB);
    });
  });

  describe('duplicate barcodes in one store', () => {
    it('picks the older listed variant, whatever the insertion order', async () => {
      const fixture = await seedStore();
      const first = await seedVariant(fixture, 'BC-DUP');
      const second = await seedVariant(fixture, 'BC-DUP');
      // The row inserted second is the older one, so insertion order cannot decide.
      await setVariantDates(first, { createdAt: daysAgo(1) });
      await setVariantDates(second, { createdAt: daysAgo(2) });

      const once = await resolveVariantIdsByBarcode(prisma, scopeOf(fixture), ['BC-DUP']);
      const twice = await resolveVariantIdsByBarcode(prisma, scopeOf(fixture), ['BC-DUP']);

      expect(once.get('BC-DUP')).toBe(second);
      expect(twice.get('BC-DUP')).toBe(second);
    });

    it('picks the smaller id when two listed variants have the same createdAt', async () => {
      const fixture = await seedStore();
      // The row written first gets the LARGER id, so without the id tie-break the physical
      // row order would pick it and this test would fail every time, not by chance.
      const first = await setVariantId(
        await seedVariant(fixture, 'BC-TIE'),
        'ffffffff-ffff-4fff-bfff-ffffffffffff',
      );
      const second = await setVariantId(
        await seedVariant(fixture, 'BC-TIE'),
        '00000000-0000-4000-8000-000000000001',
      );
      const sameDate = daysAgo(3);
      await setVariantDates(first, { createdAt: sameDate });
      await setVariantDates(second, { createdAt: sameDate });

      // Postgres happens to return this tie in id order even without the key, so the result
      // alone cannot prove the tie-break; the query must ask for it explicitly.
      const findMany = vi.spyOn(prisma.productVariant, 'findMany');
      const once = await resolveVariantIdsByBarcode(prisma, scopeOf(fixture), ['BC-TIE']);
      const twice = await resolveVariantIdsByBarcode(prisma, scopeOf(fixture), ['BC-TIE']);

      expect(once.get('BC-TIE')).toBe(second);
      expect(twice.get('BC-TIE')).toBe(second);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      );
      findMany.mockRestore();
    });

    it('picks a listed variant over an older delisted one', async () => {
      const fixture = await seedStore();
      const delisted = await seedVariant(fixture, 'BC-RELIST');
      const listed = await seedVariant(fixture, 'BC-RELIST');
      await setVariantDates(delisted, { createdAt: daysAgo(10), delistedAt: daysAgo(5) });
      await setVariantDates(listed, { createdAt: daysAgo(4), delistedAt: null });

      const result = await resolveVariantIdsByBarcode(prisma, scopeOf(fixture), ['BC-RELIST']);

      expect(result.get('BC-RELIST')).toBe(listed);
    });

    it('picks the older variant when both are delisted, even when it left the feed later', async () => {
      const fixture = await seedStore();
      const newer = await seedVariant(fixture, 'BC-GONE');
      const older = await seedVariant(fixture, 'BC-GONE');
      // The older variant was delisted AFTER the newer one, so ordering by the delisting
      // time would pick the newer row.
      await setVariantDates(newer, { createdAt: daysAgo(4), delistedAt: daysAgo(2) });
      await setVariantDates(older, { createdAt: daysAgo(10), delistedAt: daysAgo(1) });

      const result = await resolveVariantIdsByBarcode(prisma, scopeOf(fixture), ['BC-GONE']);

      expect(result.get('BC-GONE')).toBe(older);
    });
  });

  describe('query budget', () => {
    it('issues no query for an empty input', async () => {
      const fixture = await seedStore();
      let queries = 0;
      const counting = countingTransactionClient(prisma, () => {
        queries += 1;
      });

      const result = await resolveVariantIdsByBarcode(counting, scopeOf(fixture), []);

      expect(result.size).toBe(0);
      expect(queries).toBe(0);
    });

    it('issues exactly one query for many barcodes passed with duplicates', async () => {
      const fixture = await seedStore();
      const existing = Array.from(
        { length: EXISTING_BARCODE_COUNT },
        (_, index) => `BC-HIT-${index.toString()}`,
      );
      const missing = Array.from(
        { length: MISSING_BARCODE_COUNT },
        (_, index) => `BC-MISS-${index.toString()}`,
      );
      const idByBarcode = new Map<string, string>();
      for (const barcode of existing) {
        idByBarcode.set(barcode, await seedVariant(fixture, barcode));
      }

      let queries = 0;
      const counting = countingTransactionClient(prisma, () => {
        queries += 1;
      });
      const result = await resolveVariantIdsByBarcode(counting, scopeOf(fixture), [
        ...existing,
        ...missing,
        ...existing,
      ]);

      expect(queries).toBe(1);
      expect(result.size).toBe(EXISTING_BARCODE_COUNT);
      for (const [barcode, id] of idByBarcode) {
        expect(result.get(barcode)).toBe(id);
      }
      for (const barcode of missing) {
        expect(result.has(barcode)).toBe(false);
      }
    });
  });
});
