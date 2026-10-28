import { describe, expect, it } from 'vitest';

import { resolveVariantIds } from '@/features/products/components/products-bulk-cost-action-bar';
import type { ProductRow } from '@/features/products/components/products-bulk-cost-action-bar.types';
import type {
  ProductWithVariants,
  VariantSummary,
} from '@/features/products/api/list-products.api';

import { makeProductWithVariants, makeVariantSummary } from '../../../helpers/product-fixtures';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Thin adapters over the shared builders: explicit ids keep every row distinct.
function makeVariant(id: string): VariantSummary {
  return makeVariantSummary({ id });
}

function makeProduct(id: string, variantIds: string[]): ProductWithVariants {
  return makeProductWithVariants({ id, variants: variantIds.map((vid) => makeVariant(vid)) });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveVariantIds', () => {
  it('returns variant id directly for variant rows', () => {
    const parentProduct = makeProduct('p1', ['v1', 'v2']);
    const rows: ProductRow[] = [
      { kind: 'variant', parent: parentProduct, variant: makeVariant('v1') },
    ];
    expect(resolveVariantIds(rows)).toEqual(['v1']);
  });

  it('expands parent rows to all their child variant ids', () => {
    const product = makeProduct('p1', ['v1', 'v2', 'v3']);
    const rows: ProductRow[] = [{ kind: 'parent', product }];
    expect(resolveVariantIds(rows)).toEqual(['v1', 'v2', 'v3']);
  });

  it('handles mixed parent + variant selection without duplicating', () => {
    // Parent product p1 with variants v1, v2. Variant v3 from a different product.
    const product1 = makeProduct('p1', ['v1', 'v2']);
    const product2 = makeProduct('p2', ['v3', 'v4']);
    const rows: ProductRow[] = [
      { kind: 'parent', product: product1 },
      { kind: 'variant', parent: product2, variant: makeVariant('v3') },
    ];
    expect(resolveVariantIds(rows)).toEqual(['v1', 'v2', 'v3']);
  });

  it('returns empty array for empty selection', () => {
    expect(resolveVariantIds([])).toEqual([]);
  });

  it('deduplication is caller responsibility — duplicates can appear if same variant selected twice', () => {
    // This documents the current behaviour: resolveVariantIds does NOT deduplicate.
    // The API handles idempotency on its side.
    const product = makeProduct('p1', ['v1', 'v2']);
    const variant = makeVariant('v1');
    const rows: ProductRow[] = [
      { kind: 'parent', product },
      { kind: 'variant', parent: product, variant },
    ];
    const ids = resolveVariantIds(rows);
    // v1 appears twice: once from parent expansion, once from direct variant row.
    expect(ids.filter((id) => id === 'v1').length).toBe(2);
  });
});
