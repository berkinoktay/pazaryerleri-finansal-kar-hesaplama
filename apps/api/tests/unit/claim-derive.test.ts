import { describe, expect, it } from 'vitest';

import {
  deriveClaimStatus,
  deriveProductSummary,
  deriveReasonSummary,
  deriveScope,
} from '@/services/claim-derive';

describe('deriveClaimStatus', () => {
  it('returns OPEN whenever the claim is unresolved, regardless of item statuses', () => {
    expect(deriveClaimStatus(false, ['Accepted', 'Accepted'])).toBe('OPEN');
  });
  it('returns ACCEPTED when every item is Accepted', () => {
    expect(deriveClaimStatus(true, ['Accepted', 'Accepted'])).toBe('ACCEPTED');
  });
  it('returns REJECTED when every item is Rejected', () => {
    expect(deriveClaimStatus(true, ['Rejected'])).toBe('REJECTED');
  });
  it('returns CANCELLED when every item is Cancelled', () => {
    expect(deriveClaimStatus(true, ['Cancelled', 'Cancelled'])).toBe('CANCELLED');
  });
  it('returns MIXED on heterogeneous terminal statuses', () => {
    expect(deriveClaimStatus(true, ['Accepted', 'Rejected'])).toBe('MIXED');
  });
});

describe('deriveScope', () => {
  it('FULL when the claim covers every unit of the order', () => {
    expect(deriveScope(3, 3)).toBe('FULL');
  });
  it('PARTIAL when fewer units are claimed than ordered', () => {
    expect(deriveScope(1, 3)).toBe('PARTIAL');
  });
  it('FULL (defensive) when claim units somehow exceed order units', () => {
    expect(deriveScope(4, 3)).toBe('FULL');
  });
});

describe('deriveProductSummary', () => {
  const item = (title: string | null) => ({
    orderItem: title === null ? null : { productVariant: { product: { title } } },
  });
  it('single product: first name + unit count, no others', () => {
    expect(deriveProductSummary([item('Boyunluk'), item('Boyunluk')])).toEqual({
      firstName: 'Boyunluk',
      units: 2,
      otherCount: 0,
    });
  });
  it('multiple distinct products: first group + count of the rest', () => {
    expect(deriveProductSummary([item('Boyunluk'), item('Kemer'), item('Kemer')])).toEqual({
      firstName: 'Boyunluk',
      units: 1,
      otherCount: 1,
    });
  });
  it('unlinked items fall into a null-name group', () => {
    expect(deriveProductSummary([item(null), item(null)])).toEqual({
      firstName: null,
      units: 2,
      otherCount: 0,
    });
  });
  it('empty items → empty summary', () => {
    expect(deriveProductSummary([])).toEqual({ firstName: null, units: 0, otherCount: 0 });
  });
});

describe('deriveReasonSummary', () => {
  it('first distinct reason + count of the other distinct reasons', () => {
    expect(deriveReasonSummary(['Hasarlı ürün', 'Hasarlı ürün', 'Yanlış ürün'])).toEqual({
      first: 'Hasarlı ürün',
      otherCount: 1,
    });
  });
  it('empty items → empty string, zero others', () => {
    expect(deriveReasonSummary([])).toEqual({ first: '', otherCount: 0 });
  });
});
