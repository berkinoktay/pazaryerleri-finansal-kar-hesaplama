import { describe, expect, it } from 'vitest';

import { previewVariantDesi } from '@/features/products/lib/desi-cache';

import { MISSING_DESI_FIELDS, makeVariantSummary } from '../../../helpers/product-fixtures';

// previewVariantDesi is the optimistic desi state shown between a save click
// and the server answer. It mirrors the backend rule: an empty desi is
// missing, a desi of 0 is a real desi.

describe('previewVariantDesi', () => {
  it('setting an override clears the missing flag and shows the entered value', () => {
    const preview = previewVariantDesi(makeVariantSummary(MISSING_DESI_FIELDS), '1.5');
    expect(preview).toMatchObject({
      dimensionalWeight: '1.5',
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
  });

  it('an override of 0 is a real desi, not missing', () => {
    const preview = previewVariantDesi(makeVariantSummary(MISSING_DESI_FIELDS), '0');
    expect(preview).toMatchObject({
      dimensionalWeight: '0',
      isDimensionalWeightOverridden: true,
      isDimensionalWeightMissing: false,
    });
  });

  it('clearing the override with no Trendyol desi leaves no desi: missing', () => {
    const preview = previewVariantDesi(
      makeVariantSummary({
        dimensionalWeight: '2.00',
        syncedDimensionalWeight: null,
        isDimensionalWeightOverridden: true,
        isDimensionalWeightMissing: false,
      }),
      null,
    );
    expect(preview).toMatchObject({
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: true,
    });
  });

  it('clearing the override over a Trendyol desi of 0 falls back to 0, a real desi', () => {
    const preview = previewVariantDesi(
      makeVariantSummary({
        dimensionalWeight: '2.00',
        syncedDimensionalWeight: '0',
        isDimensionalWeightOverridden: true,
        isDimensionalWeightMissing: false,
      }),
      null,
    );
    expect(preview).toMatchObject({
      dimensionalWeight: '0',
      syncedDimensionalWeight: '0',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
  });

  it('clearing the override over a positive Trendyol desi falls back to it', () => {
    const preview = previewVariantDesi(
      makeVariantSummary({
        dimensionalWeight: '2.00',
        syncedDimensionalWeight: '1.20',
        isDimensionalWeightOverridden: true,
        isDimensionalWeightMissing: false,
      }),
      null,
    );
    expect(preview).toMatchObject({
      dimensionalWeight: '1.20',
      isDimensionalWeightOverridden: false,
      isDimensionalWeightMissing: false,
    });
  });
});
