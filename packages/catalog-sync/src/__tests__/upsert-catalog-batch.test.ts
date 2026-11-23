// upsertCatalogBatch unit tests.
//
// The DB (@pazarsync/db), the profit recompute enqueue (@pazarsync/profit), the
// aggregate refresh and the logger are mocked at the module boundary. No real DB.
// The desi-change enqueue is pinned here at the call level (which variants, which
// organization, which reason); the database half (the desi log row, the non-final
// filter, tenant scope) lives in apps/sync-worker/tests/integration/
// catalog-desi-enqueue.test.ts.

import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Store } from '@pazarsync/db';
import { ProductVariantStatus, ProfitRecomputeReason } from '@pazarsync/db/enums';
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
  create: { syncedDimensionalWeight?: string | null };
  update: { syncedDimensionalWeight?: string | null };
}
/** A stored variant as the pre-upsert read returns it. */
interface StoredVariantRow {
  id: string;
  platformVariantId: bigint;
  syncedDimensionalWeight: Decimal | null;
}
interface VariantFindManyArg {
  where: { organizationId: string; storeId: string; platformVariantId: { in: bigint[] } };
}
interface EnqueueArg {
  organizationId: string;
  variantIds: readonly string[];
  reason: ProfitRecomputeReason;
}

const productUpsert = vi.fn<() => Promise<{ id: string }>>();
const variantUpsert = vi.fn<(args: VariantWhereArg) => Promise<VariantRow>>();
const variantFindMany = vi.fn<(args: VariantFindManyArg) => Promise<StoredVariantRow[]>>();
const refreshAggregates = vi.fn<() => Promise<void>>();
const enqueueForVariants = vi.fn<(params: EnqueueArg) => Promise<number>>();
const syncLogError = vi.fn<(event: string, fields: unknown) => void>();

vi.mock('@pazarsync/db', () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        product: { upsert: () => productUpsert() },
        productVariant: {
          findMany: (args: VariantFindManyArg) => variantFindMany(args),
          upsert: (args: VariantWhereArg) => variantUpsert(args),
        },
      }),
  },
}));

vi.mock('@pazarsync/profit', () => ({
  enqueueProfitRecomputeForVariants: (_tx: unknown, params: EnqueueArg) =>
    enqueueForVariants(params),
}));

vi.mock('@pazarsync/sync-core', () => ({
  syncLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: (event: string, fields: unknown) => syncLogError(event, fields),
  },
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
  variantFindMany.mockResolvedValue([]);
  enqueueForVariants.mockResolvedValue(0);
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

  // Owner rule (Berkin 2026-11-23): catalog sync never erases a known Trendyol
  // desi. When Trendyol sends no usable desi (0 or absent, mapped to null) for
  // an existing variant, the update leaves the stored synced desi as it is; a
  // real value still replaces it, and a new variant is created with null.
  describe('synced desi', () => {
    function programOne(): void {
      program(
        new Map<bigint, VariantRow>([
          [
            201n,
            {
              id: 'v201',
              syncedCommissionRate: null,
              syncedDimensionalWeight: new Decimal('2'),
            },
          ],
        ]),
      );
    }

    function withDesi(syncedDimensionalWeight: string | null): MappedProduct {
      const mapped = content(201n);
      return {
        ...mapped,
        variants: mapped.variants.map((variant) => ({ ...variant, syncedDimensionalWeight })),
      };
    }

    function upsertArgs(): VariantWhereArg {
      const args = variantUpsert.mock.calls[0]?.[0];
      if (args === undefined) throw new Error('no variant upsert recorded');
      return args;
    }

    it('leaves the stored synced desi unchanged on update when Trendyol sends none', async () => {
      programOne();

      await upsertCatalogBatch(STORE, [withDesi(null)], null);

      const args = upsertArgs();
      expect(args.update.syncedDimensionalWeight).toBeUndefined();
      expect(args.update).not.toHaveProperty('syncedDimensionalWeight');
      // A new variant with no desi is still created with an empty synced desi.
      expect(args.create).toHaveProperty('syncedDimensionalWeight', null);
    });

    it('writes a real Trendyol desi on both create and update', async () => {
      programOne();

      await upsertCatalogBatch(STORE, [withDesi('3.50')], null);

      const args = upsertArgs();
      expect(args.update).toHaveProperty('syncedDimensionalWeight', '3.50');
      expect(args.create).toHaveProperty('syncedDimensionalWeight', '3.50');
    });
  });

  // Owner rule (Berkin 2026-11-23): an order's desi is the value in force at the end
  // of its business day, so a synced desi the batch changes queues the variant's
  // non-final orders (DESI_CHANGED). Only a pre-existing variant whose mapped desi is
  // a value different from the stored one is a change: a null mapped desi never
  // overwrites a stored one, and a new variant has no captured order yet.
  describe('desi change enqueue', () => {
    /** One content whose variants carry the given mapped synced desi values. */
    function contentWithDesi(
      entries: readonly (readonly [bigint, string | null])[],
    ): MappedProduct {
      const mapped = content(...entries.map(([platformVariantId]) => platformVariantId));
      const desiById = new Map<bigint, string | null>(entries);
      return {
        ...mapped,
        variants: mapped.variants.map((variant) => ({
          ...variant,
          syncedDimensionalWeight: desiById.get(variant.platformVariantId) ?? null,
        })),
      };
    }

    /** Programs the upsert for every id and the pre-upsert read with the stored rows. */
    function programStored(
      platformVariantIds: readonly bigint[],
      stored: readonly StoredVariantRow[],
    ): void {
      program(
        new Map<bigint, VariantRow>(
          platformVariantIds.map((platformVariantId) => [
            platformVariantId,
            {
              id: `v${platformVariantId.toString()}`,
              syncedCommissionRate: null,
              syncedDimensionalWeight: new Decimal('1'),
            },
          ]),
        ),
      );
      variantFindMany.mockResolvedValue([...stored]);
    }

    it("a batch that changes a variant's synced desi enqueues that variant", async () => {
      programStored(
        [201n],
        [{ id: 'v201', platformVariantId: 201n, syncedDimensionalWeight: new Decimal('2') }],
      );

      await upsertCatalogBatch(STORE, [contentWithDesi([[201n, '3.50']])], null);

      expect(syncLogError).not.toHaveBeenCalled();
      // The stored desi is read in the store's own scope, by the batch's variant ids.
      expect(variantFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', storeId: 'store-1', platformVariantId: { in: [201n] } },
        }),
      );
      expect(enqueueForVariants).toHaveBeenCalledTimes(1);
      expect(enqueueForVariants).toHaveBeenCalledWith({
        organizationId: 'org-1',
        variantIds: ['v201'],
        reason: ProfitRecomputeReason.DESI_CHANGED,
      });
    });

    it('a stored variant without a synced desi that gets one enqueues that variant', async () => {
      programStored(
        [202n],
        [{ id: 'v202', platformVariantId: 202n, syncedDimensionalWeight: null }],
      );

      await upsertCatalogBatch(STORE, [contentWithDesi([[202n, '1.00']])], null);

      expect(syncLogError).not.toHaveBeenCalled();
      expect(enqueueForVariants).toHaveBeenCalledTimes(1);
      expect(enqueueForVariants).toHaveBeenCalledWith({
        organizationId: 'org-1',
        variantIds: ['v202'],
        reason: ProfitRecomputeReason.DESI_CHANGED,
      });
    });

    it('an unchanged batch enqueues nothing: the same value, or no desi sent', async () => {
      const stored: StoredVariantRow[] = [
        { id: 'v201', platformVariantId: 201n, syncedDimensionalWeight: new Decimal('2') },
        { id: 'v202', platformVariantId: 202n, syncedDimensionalWeight: new Decimal('4') },
      ];
      programStored([201n, 202n], stored);

      // 2.00 is the stored 2 (a value comparison, not a string one); null is "Trendyol
      // sent no desi", which leaves the stored 4 in place.
      await upsertCatalogBatch(
        STORE,
        [
          contentWithDesi([
            [201n, '2.00'],
            [202n, null],
          ]),
        ],
        null,
      );

      expect(syncLogError).not.toHaveBeenCalled();
      expect(variantUpsert).toHaveBeenCalledTimes(2);
      expect(enqueueForVariants).not.toHaveBeenCalled();

      // Positive control: the same stored rows, one value changed, enqueue that one.
      await upsertCatalogBatch(
        STORE,
        [
          contentWithDesi([
            [201n, '3.00'],
            [202n, null],
          ]),
        ],
        null,
      );
      expect(enqueueForVariants).toHaveBeenCalledTimes(1);
      expect(enqueueForVariants).toHaveBeenCalledWith({
        organizationId: 'org-1',
        variantIds: ['v201'],
        reason: ProfitRecomputeReason.DESI_CHANGED,
      });
    });

    it('a new variant enqueues nothing; a changed stored one in the same batch does', async () => {
      // 201 is not stored yet (created by this batch); 202 is stored with 2.
      programStored(
        [201n, 202n],
        [{ id: 'v202', platformVariantId: 202n, syncedDimensionalWeight: new Decimal('2') }],
      );

      await upsertCatalogBatch(
        STORE,
        [
          contentWithDesi([
            [201n, '3.50'],
            [202n, '6.00'],
          ]),
        ],
        null,
      );

      expect(syncLogError).not.toHaveBeenCalled();
      expect(enqueueForVariants).toHaveBeenCalledTimes(1);
      expect(enqueueForVariants).toHaveBeenCalledWith({
        organizationId: 'org-1',
        variantIds: ['v202'],
        reason: ProfitRecomputeReason.DESI_CHANGED,
      });
    });
  });
});
