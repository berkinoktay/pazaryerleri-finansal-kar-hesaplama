// upsertCatalogBatch profit-recompute queueing unit tests (Phase 3B, Task 8).
//
// The DB (@pazarsync/db), the profit queue (@pazarsync/profit), the aggregate
// refresh and the logger are mocked at the module boundary. Each scenario
// drives the per-content BEFORE (findMany) and per-variant AFTER (upsert)
// states and asserts which variant ids reach enqueueProfitRecomputeForVariants
// — no real DB. The change detection itself (decimal.js compare, null
// transitions, new variants) is the unit under test.

import { Decimal } from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Store } from '@pazarsync/db';
import { ProductVariantStatus, ProfitRecomputeReason } from '@pazarsync/db/enums';
import type { MappedProduct, MappedProductVariant } from '@pazarsync/marketplace';

import { upsertCatalogBatch } from '../upsert-catalog-batch';

// ─── Mocks (module boundary) ─────────────────────────────────────────────

interface SyncedState {
  syncedCommissionRate: Decimal | null;
  syncedDimensionalWeight: Decimal;
}
type PriorRow = SyncedState & { platformVariantId: bigint };
type VariantRow = SyncedState & { id: string };
interface VariantWhereArg {
  where: { storeId_platformVariantId: { platformVariantId: bigint } };
}
interface VariantFindManyArg {
  where: { storeId: string; platformVariantId: { in: bigint[] } };
}

const productUpsert = vi.fn<() => Promise<{ id: string }>>();
const variantFindUnique = vi.fn<(args: VariantWhereArg) => Promise<SyncedState | null>>();
const variantFindMany = vi.fn<(args: VariantFindManyArg) => Promise<PriorRow[]>>();
const variantUpsert = vi.fn<(args: VariantWhereArg) => Promise<VariantRow>>();
const refreshAggregates = vi.fn<() => Promise<void>>();
const enqueueForVariants = vi.fn<
  (
    tx: unknown,
    params: {
      organizationId: string;
      variantIds: readonly string[];
      reason: ProfitRecomputeReason;
    },
  ) => Promise<number>
>();

vi.mock('@pazarsync/db', () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        product: { upsert: () => productUpsert() },
        productVariant: {
          findUnique: (args: VariantWhereArg) => variantFindUnique(args),
          findMany: (args: VariantFindManyArg) => variantFindMany(args),
          upsert: (args: VariantWhereArg) => variantUpsert(args),
        },
      }),
  },
}));

vi.mock('@pazarsync/profit', () => ({
  enqueueProfitRecomputeForVariants: (
    tx: unknown,
    params: {
      organizationId: string;
      variantIds: readonly string[];
      reason: ProfitRecomputeReason;
    },
  ) => enqueueForVariants(tx, params),
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

/** Programs the per-content BEFORE (findMany) and per-variant AFTER (upsert) state the mocked DB returns, keyed by platformVariantId. */
function program(states: Map<bigint, { before: SyncedState | null; after: VariantRow }>): void {
  variantFindMany.mockImplementation((args) => {
    const requested = new Set(args.where.platformVariantId.in);
    const rows: PriorRow[] = [];
    for (const [platformVariantId, state] of states) {
      if (state.before !== null && requested.has(platformVariantId)) {
        rows.push({ platformVariantId, ...state.before });
      }
    }
    return Promise.resolve(rows);
  });
  variantUpsert.mockImplementation((args) => {
    const row = states.get(args.where.storeId_platformVariantId.platformVariantId)?.after;
    if (row === undefined) throw new Error('unprogrammed variant upsert');
    return Promise.resolve(row);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  productUpsert.mockResolvedValue({ id: 'product-1' });
  refreshAggregates.mockResolvedValue(undefined);
  enqueueForVariants.mockResolvedValue(0);
});

describe('upsertCatalogBatch — profit recompute queueing', () => {
  it('queues only the variants whose synced rate or desi changed in a catalog batch', async () => {
    const states = new Map<bigint, { before: SyncedState | null; after: VariantRow }>([
      // rate 20 -> 25: changed
      [
        101n,
        {
          before: {
            syncedCommissionRate: new Decimal('20'),
            syncedDimensionalWeight: new Decimal('3'),
          },
          after: {
            id: 'v101',
            syncedCommissionRate: new Decimal('25'),
            syncedDimensionalWeight: new Decimal('3'),
          },
        },
      ],
      // unchanged
      [
        102n,
        {
          before: {
            syncedCommissionRate: new Decimal('15'),
            syncedDimensionalWeight: new Decimal('2'),
          },
          after: {
            id: 'v102',
            syncedCommissionRate: new Decimal('15'),
            syncedDimensionalWeight: new Decimal('2'),
          },
        },
      ],
      // new variant (no prior row): has orders nowhere yet -> never queued
      [
        103n,
        {
          before: null,
          after: {
            id: 'v103',
            syncedCommissionRate: new Decimal('30'),
            syncedDimensionalWeight: new Decimal('5'),
          },
        },
      ],
      // desi 1 -> 4: changed
      [
        104n,
        {
          before: {
            syncedCommissionRate: new Decimal('10'),
            syncedDimensionalWeight: new Decimal('1'),
          },
          after: {
            id: 'v104',
            syncedCommissionRate: new Decimal('10'),
            syncedDimensionalWeight: new Decimal('4'),
          },
        },
      ],
      // rate null -> 21: changed (null transition)
      [
        105n,
        {
          before: { syncedCommissionRate: null, syncedDimensionalWeight: new Decimal('2') },
          after: {
            id: 'v105',
            syncedCommissionRate: new Decimal('21'),
            syncedDimensionalWeight: new Decimal('2'),
          },
        },
      ],
    ]);
    program(states);

    await upsertCatalogBatch(STORE, [content(101n, 102n, 103n, 104n, 105n)], null);

    expect(enqueueForVariants).toHaveBeenCalledTimes(1);
    expect(enqueueForVariants).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      variantIds: ['v101', 'v104', 'v105'],
      reason: ProfitRecomputeReason.REFERENCE_CHANGED,
    });
  });

  it('does not queue when no synced value changed, including equal decimal representations', async () => {
    const states = new Map<bigint, { before: SyncedState | null; after: VariantRow }>([
      // 21.00 vs 21 and 3.0 vs 3 are numerically equal -> unchanged
      [
        201n,
        {
          before: {
            syncedCommissionRate: new Decimal('21.00'),
            syncedDimensionalWeight: new Decimal('3.0'),
          },
          after: {
            id: 'v201',
            syncedCommissionRate: new Decimal('21'),
            syncedDimensionalWeight: new Decimal('3'),
          },
        },
      ],
    ]);
    program(states);

    await upsertCatalogBatch(STORE, [content(201n)], null);

    expect(enqueueForVariants).not.toHaveBeenCalled();
  });

  it('reads prior synced values with a single findMany and no findUnique per content', async () => {
    const states = new Map<bigint, { before: SyncedState | null; after: VariantRow }>([
      [
        301n,
        {
          before: {
            syncedCommissionRate: new Decimal('10'),
            syncedDimensionalWeight: new Decimal('1'),
          },
          after: {
            id: 'v301',
            syncedCommissionRate: new Decimal('10'),
            syncedDimensionalWeight: new Decimal('1'),
          },
        },
      ],
      [
        302n,
        {
          before: {
            syncedCommissionRate: new Decimal('12'),
            syncedDimensionalWeight: new Decimal('2'),
          },
          after: {
            id: 'v302',
            syncedCommissionRate: new Decimal('12'),
            syncedDimensionalWeight: new Decimal('2'),
          },
        },
      ],
      [
        303n,
        {
          before: {
            syncedCommissionRate: new Decimal('14'),
            syncedDimensionalWeight: new Decimal('3'),
          },
          after: {
            id: 'v303',
            syncedCommissionRate: new Decimal('14'),
            syncedDimensionalWeight: new Decimal('3'),
          },
        },
      ],
    ]);
    program(states);

    await upsertCatalogBatch(STORE, [content(301n, 302n, 303n)], null);

    expect(variantFindMany).toHaveBeenCalledTimes(1);
    expect(variantFindUnique).not.toHaveBeenCalled();
    expect(variantUpsert).toHaveBeenCalledTimes(3);
  });
});
