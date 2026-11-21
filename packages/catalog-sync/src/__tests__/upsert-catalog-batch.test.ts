// upsertCatalogBatch unit tests.
//
// The DB (@pazarsync/db), the aggregate refresh and the logger are mocked at the
// module boundary. No real DB. There are no profit recompute queueing tests: the
// package no longer depends on @pazarsync/profit, so the catalog write path cannot
// queue a stored order for a recompute (their inputs are frozen at intake).

import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Store } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';
import type { MappedProduct, MappedProductVariant } from '@pazarsync/marketplace';

import { upsertCatalogBatch } from '../upsert-catalog-batch';

// ─── Mocks (module boundary) ─────────────────────────────────────────────

interface VariantRow {
  id: string;
  syncedCommissionRate: Decimal | null;
  syncedDimensionalWeight: Decimal;
}
interface VariantWhereArg {
  where: { storeId_platformVariantId: { platformVariantId: bigint } };
}

const productUpsert = vi.fn<() => Promise<{ id: string }>>();
const variantUpsert = vi.fn<(args: VariantWhereArg) => Promise<VariantRow>>();
const refreshAggregates = vi.fn<() => Promise<void>>();

vi.mock('@pazarsync/db', () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        product: { upsert: () => productUpsert() },
        productVariant: {
          upsert: (args: VariantWhereArg) => variantUpsert(args),
        },
      }),
  },
}));

vi.mock('@pazarsync/sync-core', () => ({
  syncLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../refresh-product-aggregates', () => ({
  refreshProductAggregates: () => refreshAggregates(),
}));

// ─── Helpers ───────────────────────────────────────────────────────────────

const STORE: Store = { id: 'store-1', organizationId: 'org-1' } as unknown as Store;

function mappedVariant(platformVariantId: bigint): MappedProductVariant {
  return {
    platformVariantId,
    barcode: `BC-${platformVariantId.toString()}`,
    stockCode: '',
    salePrice: '0.00',
    listPrice: '0.00',
    vatRate: null,
    quantity: 0,
    deliveryDuration: null,
    productUrl: null,
    size: null,
    attributes: [],
    syncedDimensionalWeight: '0',
    syncedCommissionRate: null,
    status: ProductVariantStatus.NOT_ON_SALE,
    statusReason: null,
  };
}

function content(...platformVariantIds: bigint[]): MappedProduct {
  return {
    platformContentId: 1n,
    productMainId: 'PM-1',
    title: 'Test',
    description: null,
    brandId: null,
    brandName: null,
    categoryId: null,
    categoryName: null,
    color: null,
    attributes: [],
    platformCreatedAt: null,
    platformModifiedAt: null,
    imageUrls: [],
    variants: platformVariantIds.map(mappedVariant),
  };
}

/** Programs the per-variant row the mocked variant upsert returns, keyed by platformVariantId. */
function program(rows: Map<bigint, VariantRow>): void {
  variantUpsert.mockImplementation((args) => {
    const row = rows.get(args.where.storeId_platformVariantId.platformVariantId);
    if (row === undefined) throw new Error('unprogrammed variant upsert');
    return Promise.resolve(row);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  productUpsert.mockResolvedValue({ id: 'product-1' });
  refreshAggregates.mockResolvedValue(undefined);
});

describe('upsertCatalogBatch', () => {
  it('upserts every variant of a catalog batch once', async () => {
    const rows = new Map<bigint, VariantRow>([
      [
        101n,
        {
          id: 'v101',
          syncedCommissionRate: new Decimal('25'),
          syncedDimensionalWeight: new Decimal('3'),
        },
      ],
      [
        102n,
        {
          id: 'v102',
          syncedCommissionRate: new Decimal('15'),
          syncedDimensionalWeight: new Decimal('2'),
        },
      ],
      [
        103n,
        {
          id: 'v103',
          syncedCommissionRate: new Decimal('30'),
          syncedDimensionalWeight: new Decimal('5'),
        },
      ],
      [
        104n,
        {
          id: 'v104',
          syncedCommissionRate: new Decimal('10'),
          syncedDimensionalWeight: new Decimal('4'),
        },
      ],
      [
        105n,
        {
          id: 'v105',
          syncedCommissionRate: new Decimal('21'),
          syncedDimensionalWeight: new Decimal('2'),
        },
      ],
    ]);
    program(rows);

    await upsertCatalogBatch(STORE, [content(101n, 102n, 103n, 104n, 105n)], null);

    expect(variantUpsert).toHaveBeenCalledTimes(5);
  });
});
