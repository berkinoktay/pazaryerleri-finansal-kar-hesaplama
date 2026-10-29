import { CostProfileType, ProfitLineLevel, ProfitLineType } from '@pazarsync/db/enums';
import { describe, expect, it } from 'vitest';

import { COST_PROFILE_LINE_TYPE } from '../cost-profile-line-type';
import { getLineSpec, PROFIT_LINE_CATALOG } from '../profit-line-catalog';

describe('PROFIT_LINE_CATALOG', () => {
  it('has a spec for every ProfitLineType', () => {
    expect(Object.keys(PROFIT_LINE_CATALOG).sort()).toEqual(Object.values(ProfitLineType).sort());
  });
  it('sets allocationBasis exactly for parcel-capable types', () => {
    for (const spec of Object.values(PROFIT_LINE_CATALOG)) {
      expect(spec.levels.includes(ProfitLineLevel.PARCEL)).toBe(spec.allocationBasis !== null);
    }
  });
  it('gives revenue types output VAT and tax types no VAT', () => {
    for (const spec of Object.values(PROFIT_LINE_CATALOG)) {
      if (spec.group === 'REVENUE') expect(spec.vatKind).toBe('OUTPUT');
      if (spec.group === 'TAX') expect(spec.vatKind).toBe('NONE');
    }
  });
  it('uses unique profit.lines.<camelCase> label keys', () => {
    const keys = Object.values(PROFIT_LINE_CATALOG).map((s) => s.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^profit\.lines\.[a-z][a-zA-Z]+$/);
  });
  it('maps every CostProfileType to a product cost expense type', () => {
    expect(Object.keys(COST_PROFILE_LINE_TYPE).sort()).toEqual(
      Object.values(CostProfileType).sort(),
    );
    for (const type of Object.values(COST_PROFILE_LINE_TYPE)) {
      expect(getLineSpec(type).group).toBe('PRODUCT_COST');
      expect(getLineSpec(type).direction).toBe('EXPENSE');
    }
  });
});
