import { describe, expect, it } from 'vitest';

import {
  createCostProfileSchema,
  listCostProfilesQuerySchema,
} from '@/validators/cost-profile.validator';

// A cost profile is store-scoped: both schemas require a storeId.
const STORE_ID = '00000000-0000-4000-8000-000000000000';

// ─── createCostProfileSchema ──────────────────────────────────────────────────

describe('createCostProfileSchema', () => {
  const base = {
    storeId: STORE_ID,
    name: 'Hammadde COGS',
    type: 'COGS' as const,
    amountGross: '25.50',
    vatRate: 18,
  };

  it('accepts a valid profile', () => {
    const result = createCostProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = createCostProfileSchema.safeParse({ ...base, name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasNameIssue = result.error.issues.some((issue) => issue.path.includes('name'));
      expect(hasNameIssue).toBe(true);
    }
  });

  it('rejects amountGross with more than 2 decimal places', () => {
    const result = createCostProfileSchema.safeParse({ ...base, amountGross: '25.123' });
    expect(result.success).toBe(false);
  });

  it('rejects vatRate above 100', () => {
    const result = createCostProfileSchema.safeParse({ ...base, vatRate: 101 });
    expect(result.success).toBe(false);
  });

  it('applies defaults: vatRate 0', () => {
    const minimal = {
      storeId: STORE_ID,
      name: 'Minimal',
      type: 'PACKAGING' as const,
      amountGross: '10.00',
    };
    const result = createCostProfileSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vatRate).toBe(0);
    }
  });
});

// ─── listCostProfilesQuerySchema ─────────────────────────────────────────────

describe('listCostProfilesQuerySchema', () => {
  it('accepts the required storeId with defaults', () => {
    const result = listCostProfilesQuerySchema.safeParse({ storeId: STORE_ID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.archived).toBeUndefined();
      expect(result.data.type).toBeUndefined();
    }
  });

  it('transforms archived string to boolean', () => {
    const trueResult = listCostProfilesQuerySchema.safeParse({
      storeId: STORE_ID,
      archived: 'true',
    });
    expect(trueResult.success).toBe(true);
    if (trueResult.success) expect(trueResult.data.archived).toBe(true);

    const falseResult = listCostProfilesQuerySchema.safeParse({
      storeId: STORE_ID,
      archived: 'false',
    });
    expect(falseResult.success).toBe(true);
    if (falseResult.success) expect(falseResult.data.archived).toBe(false);
  });

  it('rejects an invalid CostProfileType', () => {
    const result = listCostProfilesQuerySchema.safeParse({
      storeId: STORE_ID,
      type: 'INVALID_TYPE',
    });
    expect(result.success).toBe(false);
  });

  it('coerces limit from string and rejects out-of-range values', () => {
    const validResult = listCostProfilesQuerySchema.safeParse({ storeId: STORE_ID, limit: '50' });
    expect(validResult.success).toBe(true);
    if (validResult.success) expect(validResult.data.limit).toBe(50);

    const tooLargeResult = listCostProfilesQuerySchema.safeParse({
      storeId: STORE_ID,
      limit: '101',
    });
    expect(tooLargeResult.success).toBe(false);
  });
});
