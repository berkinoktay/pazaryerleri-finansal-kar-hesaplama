// Pure unit test for the PRODUCTS_DELTA in-memory diff. No DB — the helper
// takes plain values (bigint ids, decimal strings) so the change-detection
// logic is exercised in isolation from Prisma.

import { describe, expect, it } from 'vitest';

import {
  computeVariantChanges,
  type ExistingVariantState,
  type FetchedVariant,
} from '../../../src/handlers/products-delta-diff';

function existing(
  overrides: Partial<ExistingVariantState> & Pick<ExistingVariantState, 'id' | 'productId'>,
): ExistingVariantState {
  return {
    quantity: 10,
    salePrice: '100.00',
    listPrice: '120.00',
    delistedAt: null,
    ...overrides,
  };
}

function fetched(
  overrides: Partial<FetchedVariant> & Pick<FetchedVariant, 'platformVariantId'>,
): FetchedVariant {
  return {
    quantity: 10,
    salePrice: '100.00',
    listPrice: '120.00',
    ...overrides,
  };
}

function mapOf(rows: ExistingVariantState[], ids: bigint[]): Map<bigint, ExistingVariantState> {
  const map = new Map<bigint, ExistingVariantState>();
  rows.forEach((row, i) => {
    const key = ids[i];
    if (key === undefined) throw new Error('mapOf: ids/rows length mismatch');
    map.set(key, row);
  });
  return map;
}

describe('computeVariantChanges', () => {
  it('flags a quantity change', () => {
    const map = mapOf([existing({ id: 'v1', productId: 'p1', quantity: 10 })], [1n]);
    const result = computeVariantChanges([fetched({ platformVariantId: 1n, quantity: 7 })], map);

    expect(result.updates).toEqual([
      {
        id: 'v1',
        productId: 'p1',
        quantity: 7,
        salePrice: '100.00',
        listPrice: '120.00',
        clearDelistedAt: false,
      },
    ]);
    expect(result.affectedProductIds).toEqual(['p1']);
    expect(result.unknownCount).toBe(0);
  });

  it('flags a sale-price change and a list-price change', () => {
    const map = mapOf([existing({ id: 'v1', productId: 'p1' })], [1n]);
    const saleOnly = computeVariantChanges(
      [fetched({ platformVariantId: 1n, salePrice: '90.00' })],
      map,
    );
    const listOnly = computeVariantChanges(
      [fetched({ platformVariantId: 1n, listPrice: '130.00' })],
      map,
    );

    expect(saleOnly.updates[0]?.salePrice).toBe('90.00');
    expect(listOnly.updates[0]?.listPrice).toBe('130.00');
  });

  it('treats an unchanged variant as no-op, even when the DB decimal lacks trailing zeros', () => {
    // DB Decimal(12,2) rendered by Prisma strips trailing zeros ("100" not
    // "100.00"); the fetcher always emits 2-dp. `.equals` must see them equal.
    const map = mapOf(
      [existing({ id: 'v1', productId: 'p1', quantity: 5, salePrice: '100', listPrice: '120' })],
      [1n],
    );
    const result = computeVariantChanges(
      [fetched({ platformVariantId: 1n, quantity: 5, salePrice: '100.00', listPrice: '120.00' })],
      map,
    );

    expect(result.updates).toHaveLength(0);
    expect(result.affectedProductIds).toEqual([]);
  });

  it('counts unknown platformVariantIds and skips them', () => {
    const map = mapOf([existing({ id: 'v1', productId: 'p1' })], [1n]);
    const result = computeVariantChanges(
      [
        fetched({ platformVariantId: 1n, quantity: 3 }),
        fetched({ platformVariantId: 999n, quantity: 1 }),
      ],
      map,
    );

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.id).toBe('v1');
    expect(result.unknownCount).toBe(1);
  });

  it('deduplicates affectedProductIds when multiple variants of one product change', () => {
    const map = mapOf(
      [
        existing({ id: 'v1', productId: 'p1', quantity: 10 }),
        existing({ id: 'v2', productId: 'p1', quantity: 10 }),
      ],
      [1n, 2n],
    );
    const result = computeVariantChanges(
      [
        fetched({ platformVariantId: 1n, quantity: 4 }),
        fetched({ platformVariantId: 2n, quantity: 8 }),
      ],
      map,
    );

    expect(result.updates).toHaveLength(2);
    expect(result.affectedProductIds).toEqual(['p1']);
  });

  it('forces an update to clear delistedAt on reappearance, even when qty/prices are unchanged', () => {
    // Row still stamped delisted by a prior full-scan absence pass. The variant
    // is back in the feed with identical stock/price — its mere presence is
    // proof of listing, so the diff must emit an update flagged to clear it.
    const map = mapOf(
      [
        existing({
          id: 'v1',
          productId: 'p1',
          quantity: 10,
          salePrice: '100.00',
          listPrice: '120.00',
          delistedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      [1n],
    );
    const result = computeVariantChanges(
      [fetched({ platformVariantId: 1n, quantity: 10, salePrice: '100.00', listPrice: '120.00' })],
      map,
    );

    expect(result.updates).toEqual([
      {
        id: 'v1',
        productId: 'p1',
        quantity: 10,
        salePrice: '100.00',
        listPrice: '120.00',
        clearDelistedAt: true,
      },
    ]);
    expect(result.affectedProductIds).toEqual(['p1']);
  });

  it('leaves clearDelistedAt false for a normal drift on a still-listed row', () => {
    const map = mapOf(
      [existing({ id: 'v1', productId: 'p1', quantity: 10, delistedAt: null })],
      [1n],
    );
    const result = computeVariantChanges([fetched({ platformVariantId: 1n, quantity: 3 })], map);

    expect(result.updates[0]?.clearDelistedAt).toBe(false);
  });

  it('sets both the drift AND the clear flag when a delisted row also drifted', () => {
    const map = mapOf(
      [
        existing({
          id: 'v1',
          productId: 'p1',
          quantity: 10,
          delistedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      [1n],
    );
    const result = computeVariantChanges([fetched({ platformVariantId: 1n, quantity: 2 })], map);

    expect(result.updates[0]?.quantity).toBe(2);
    expect(result.updates[0]?.clearDelistedAt).toBe(true);
  });
});
