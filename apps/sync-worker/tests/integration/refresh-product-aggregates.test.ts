// Integration test for refreshProductAggregates (@pazarsync/catalog-sync). The
// denormalized Product aggregates must count only the variants in the default
// listing scope (LISTED_VARIANT_WHERE: delistedAt IS NULL and status not
// ARCHIVED). Lives in the sync-worker suite because packages/catalog-sync has no
// DB test harness (its test:unit runs DB-free mocks) and the sync worker is the
// helper's main caller. Reuses apps/api test helpers like the other suites here.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { refreshProductAggregates } from '@pazarsync/catalog-sync';
import { prisma } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';

import {
  createOrganization,
  createProduct,
  createProductVariant,
  createStore,
} from '../../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../../apps/api/tests/helpers/db';

interface VariantSeed {
  quantity: number;
  salePrice: string;
  status?: ProductVariantStatus;
  delistedAt?: Date | null;
}

interface AggregateSnapshot {
  totalStock: number;
  minSalePrice: string | null;
  maxSalePrice: string | null;
}

const DELISTED_AT = new Date('2026-01-01T00:00:00.000Z');

// One product with the given variants; optional aggregates simulate the totals
// an earlier write left behind.
async function seedProduct(
  orgId: string,
  storeId: string,
  variants: VariantSeed[],
  aggregates?: AggregateSnapshot,
): Promise<string> {
  const product = await createProduct(orgId, storeId);
  for (const spec of variants) {
    const variant = await createProductVariant(orgId, storeId, product.id, {
      salePrice: spec.salePrice,
      listPrice: spec.salePrice,
    });
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: {
        quantity: spec.quantity,
        status: spec.status ?? ProductVariantStatus.ON_SALE,
        delistedAt: spec.delistedAt ?? null,
      },
    });
  }
  if (aggregates !== undefined) {
    await prisma.product.update({ where: { id: product.id }, data: aggregates });
  }
  return product.id;
}

// Prisma Decimal.toString() drops trailing zeros ('89.50' reads back as '89.5').
async function readAggregates(productId: string): Promise<AggregateSnapshot> {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  return {
    totalStock: product.totalStock,
    minSalePrice: product.minSalePrice?.toString() ?? null,
    maxSalePrice: product.maxSalePrice?.toString() ?? null,
  };
}

async function refresh(storeId: string, productIds: readonly string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await refreshProductAggregates(tx, storeId, productIds);
  });
}

// A promise the test opens by hand, used to hold one transaction open while a
// second one runs against the same product.
interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const LOCK_WAIT_POLL_MS = 25;
const LOCK_WAIT_DEADLINE_MS = 10_000;
const INTERLEAVING_TEST_TIMEOUT_MS = 30_000;
// The interleaved transactions stay open across polling; generous budgets keep
// a loaded machine from expiring them mid-test.
const INTERLEAVED_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

// Resolves once some session in this database is waiting on a lock, i.e. the
// second writer reached the product row the first writer still holds.
async function waitForLockWaiter(): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
      ) AS waiting
    `;
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
  }
  throw new Error('No session waited on a lock before the deadline');
}

describe('refreshProductAggregates', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('counts only listed, non-archived variants: archived and delisted ones stay out', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const productId = await seedProduct(org.id, store.id, [
      { quantity: 7, salePrice: '89.50' },
      // Not on sale and locked variants are still listed, so they count.
      { quantity: 3, salePrice: '120.00', status: ProductVariantStatus.NOT_ON_SALE },
      { quantity: 2, salePrice: '150.00', status: ProductVariantStatus.LOCKED },
      // Blacklisted variants are still listed (only ARCHIVED leaves the scope),
      // so this one counts too and sets the upper price bound.
      { quantity: 1, salePrice: '200.00', status: ProductVariantStatus.BLACKLISTED },
      { quantity: 100, salePrice: '10.00', status: ProductVariantStatus.ARCHIVED },
      { quantity: 50, salePrice: '5.00', delistedAt: DELISTED_AT },
    ]);

    await refresh(store.id, [productId]);

    expect(await readAggregates(productId)).toEqual({
      totalStock: 13,
      minSalePrice: '89.5',
      maxSalePrice: '200',
    });
  });

  it('writes totalStock 0 and null price bounds for a product with no in-scope variant', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const productId = await seedProduct(
      org.id,
      store.id,
      [
        { quantity: 4, salePrice: '20.00', status: ProductVariantStatus.ARCHIVED },
        { quantity: 6, salePrice: '40.00', delistedAt: DELISTED_AT },
      ],
      { totalStock: 10, minSalePrice: '20', maxSalePrice: '40' },
    );

    await refresh(store.id, [productId]);

    expect(await readAggregates(productId)).toEqual({
      totalStock: 0,
      minSalePrice: null,
      maxSalePrice: null,
    });
  });

  it('refreshes several products in one call and tolerates duplicate ids', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const first = await seedProduct(org.id, store.id, [
      { quantity: 1, salePrice: '10.00' },
      { quantity: 2, salePrice: '20.00' },
    ]);
    const second = await seedProduct(org.id, store.id, [{ quantity: 5, salePrice: '50.00' }]);

    await refresh(store.id, [first, second, first]);

    expect(await readAggregates(first)).toEqual({
      totalStock: 3,
      minSalePrice: '10',
      maxSalePrice: '20',
    });
    expect(await readAggregates(second)).toEqual({
      totalStock: 5,
      minSalePrice: '50',
      maxSalePrice: '50',
    });
  });

  it('is a no-op for an empty product list', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const stale = { totalStock: 99, minSalePrice: '1', maxSalePrice: '2' };
    const productId = await seedProduct(
      org.id,
      store.id,
      [{ quantity: 1, salePrice: '10.00' }],
      stale,
    );

    await refresh(store.id, []);

    expect(await readAggregates(productId)).toEqual(stale);
  });

  it('is store-scoped: an id from another tenant fails the refresh and rolls it back', async () => {
    const org = await createOrganization();
    const store = await createStore(org.id);
    const otherOrg = await createOrganization();
    const otherStore = await createStore(otherOrg.id);
    const stale = { totalStock: 99, minSalePrice: '1', maxSalePrice: '2' };
    const own = await seedProduct(org.id, store.id, [{ quantity: 1, salePrice: '10.00' }], stale);
    const foreign = await seedProduct(
      otherOrg.id,
      otherStore.id,
      [{ quantity: 4, salePrice: '40.00' }],
      stale,
    );

    await expect(refresh(store.id, [own, foreign])).rejects.toMatchObject({ code: 'P2025' });

    // Neither product moved: the foreign one never matched, and the own one's
    // update rolled back with the transaction.
    expect(await readAggregates(own)).toEqual(stale);
    expect(await readAggregates(foreign)).toEqual(stale);
  });

  it(
    'serializes concurrent refreshes of one product: the later writer reads the earlier commit',
    async () => {
      const org = await createOrganization();
      const store = await createStore(org.id);
      const productId = await seedProduct(org.id, store.id, [
        { quantity: 5, salePrice: '10.00' },
        { quantity: 3, salePrice: '20.00' },
      ]);
      const [cheap, dear] = await prisma.productVariant.findMany({
        where: { productId },
        orderBy: { salePrice: 'asc' },
        select: { id: true },
      });
      if (cheap === undefined || dear === undefined) throw new Error('seed failed');

      // Writer B (a delist chunk) stamps the cheap variant, refreshes, then
      // holds its transaction open with the product row locked.
      const writerBRefreshed = createGate();
      const releaseWriterB = createGate();
      const writerB = prisma.$transaction(async (tx) => {
        await tx.productVariant.update({
          where: { id: cheap.id },
          data: { delistedAt: DELISTED_AT },
        });
        await refreshProductAggregates(tx, store.id, [productId]);
        writerBRefreshed.open();
        await releaseWriterB.promise;
      }, INTERLEAVED_TX_OPTIONS);
      await writerBRefreshed.promise;

      // Writer A (an order intake) changes the other variant and refreshes while
      // B is still open. It must wait for the product row BEFORE it reads the
      // variants; reading first would compute totals that still count the cheap
      // variant and overwrite B's commit with them.
      const writerA = prisma.$transaction(async (tx) => {
        await tx.productVariant.update({ where: { id: dear.id }, data: { quantity: 2 } });
        await refreshProductAggregates(tx, store.id, [productId]);
      }, INTERLEAVED_TX_OPTIONS);

      try {
        await waitForLockWaiter();
      } finally {
        releaseWriterB.open();
      }
      await Promise.all([writerB, writerA]);

      expect(await readAggregates(productId)).toEqual({
        totalStock: 2,
        minSalePrice: '20',
        maxSalePrice: '20',
      });
    },
    INTERLEAVING_TEST_TIMEOUT_MS,
  );
});
