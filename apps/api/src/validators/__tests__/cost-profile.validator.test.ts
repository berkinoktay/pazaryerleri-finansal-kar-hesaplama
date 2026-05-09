import { describe, expect, it } from 'vitest';

import { createCostProfileSchema, listCostProfilesQuerySchema } from '../cost-profile.validator';

// ─── createCostProfileSchema ──────────────────────────────────────────────────

describe('createCostProfileSchema', () => {
  const base = {
    name: 'Hammadde COGS',
    type: 'COGS' as const,
    amount: '25.50',
    currency: 'TRY' as const,
    vatRate: 18,
    fxRateMode: 'AUTO' as const,
  };

  it('accepts a valid TRY / AUTO profile', () => {
    const result = createCostProfileSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('requires manualFxRate when fxRateMode is MANUAL', () => {
    const result = createCostProfileSchema.safeParse({
      ...base,
      currency: 'USD',
      fxRateMode: 'MANUAL',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasManualFxRateIssue = result.error.issues.some(
        (issue) =>
          issue.path.includes('manualFxRate') || issue.message === 'MANUAL_FX_RATE_REQUIRED',
      );
      expect(hasManualFxRateIssue).toBe(true);
    }
  });

  it('accepts a valid USD / MANUAL profile with manualFxRate', () => {
    const result = createCostProfileSchema.safeParse({
      ...base,
      currency: 'USD',
      fxRateMode: 'MANUAL',
      manualFxRate: '35.500000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects currency TRY with fxRateMode MANUAL (TRY must use AUTO)', () => {
    const result = createCostProfileSchema.safeParse({
      ...base,
      currency: 'TRY',
      fxRateMode: 'MANUAL',
      manualFxRate: '1.000000',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasFxModeIssue = result.error.issues.some(
        (issue) => issue.path.includes('fxRateMode') || issue.message === 'TRY_MUST_USE_AUTO_FX',
      );
      expect(hasFxModeIssue).toBe(true);
    }
  });

  it('rejects an empty name', () => {
    const result = createCostProfileSchema.safeParse({ ...base, name: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const hasNameIssue = result.error.issues.some((issue) => issue.path.includes('name'));
      expect(hasNameIssue).toBe(true);
    }
  });

  it('rejects amount with more than 2 decimal places', () => {
    const result = createCostProfileSchema.safeParse({ ...base, amount: '25.123' });
    expect(result.success).toBe(false);
  });

  it('rejects vatRate above 100', () => {
    const result = createCostProfileSchema.safeParse({ ...base, vatRate: 101 });
    expect(result.success).toBe(false);
  });

  it('applies defaults: currency TRY, vatRate 0, fxRateMode AUTO', () => {
    const minimal = { name: 'Minimal', type: 'PACKAGING' as const, amount: '10.00' };
    const result = createCostProfileSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('TRY');
      expect(result.data.vatRate).toBe(0);
      expect(result.data.fxRateMode).toBe('AUTO');
    }
  });
});

// ─── listCostProfilesQuerySchema ─────────────────────────────────────────────

describe('listCostProfilesQuerySchema', () => {
  it('accepts empty params with defaults', () => {
    const result = listCostProfilesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
      expect(result.data.archived).toBeUndefined();
      expect(result.data.type).toBeUndefined();
    }
  });

  it('transforms archived string to boolean', () => {
    const trueResult = listCostProfilesQuerySchema.safeParse({ archived: 'true' });
    expect(trueResult.success).toBe(true);
    if (trueResult.success) expect(trueResult.data.archived).toBe(true);

    const falseResult = listCostProfilesQuerySchema.safeParse({ archived: 'false' });
    expect(falseResult.success).toBe(true);
    if (falseResult.success) expect(falseResult.data.archived).toBe(false);
  });

  it('rejects an invalid CostProfileType', () => {
    const result = listCostProfilesQuerySchema.safeParse({ type: 'INVALID_TYPE' });
    expect(result.success).toBe(false);
  });

  it('coerces limit from string and rejects out-of-range values', () => {
    const validResult = listCostProfilesQuerySchema.safeParse({ limit: '50' });
    expect(validResult.success).toBe(true);
    if (validResult.success) expect(validResult.data.limit).toBe(50);

    const tooLargeResult = listCostProfilesQuerySchema.safeParse({ limit: '101' });
    expect(tooLargeResult.success).toBe(false);
  });
});
