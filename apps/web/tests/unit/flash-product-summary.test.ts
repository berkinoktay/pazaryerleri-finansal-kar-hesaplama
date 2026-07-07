import { describe, expect, it } from 'vitest';

import type { FlashBand, FlashProductRow } from '@/features/campaigns/lib/adapt-flash-product';
import { summarizeFlashSelection } from '@/features/campaigns/lib/flash-product-summary';

/** The row's single 24 Saatlik offer, carrying the offer-join net profit under key h24. */
function offer(netProfit: string | null): FlashBand {
  return {
    key: 'h24',
    price: '600.00',
    commissionPct: '13.10',
    netProfit,
    marginPct: '10.00',
    startsAt: '2026-07-08T00:00:00Z',
    endsAt: '2026-07-08T23:59:00Z',
    validity: 'active',
  };
}

function makeRow(
  id: string,
  currentNetProfit: string | null,
  offerNetProfit: string | null,
): FlashProductRow {
  return {
    id,
    barcode: id,
    modelCode: null,
    productTitle: id,
    imageUrl: null,
    category: null,
    brand: null,
    stock: null,
    currentPrice: '800.00',
    customerPrice: '800.00',
    currentCommissionPct: '19.00',
    currentNetProfit,
    currentMarginPct: '5.00',
    calculable: true,
    reason: null,
    hasCommissionTariff: true,
    commissionSource: 'band',
    commissionBands: null,
    selectedOffer: null,
    customPrice: null,
    bands: [offer(offerNetProfit)],
  };
}

// a: current 5, offer 30. b: current 8, offer 12.
const rows: FlashProductRow[] = [makeRow('a', '5', '30'), makeRow('b', '8', '12')];

describe('summarizeFlashSelection', () => {
  it('sums the current baseline and reports zero joined when nothing is opted in', () => {
    const summary = summarizeFlashSelection(rows, {}, {});
    expect(summary.total).toBe(2);
    expect(summary.joinedCount).toBe(0);
    expect(summary.joinedProfit.toString()).toBe('0');
    // currentProfit = every row's current net profit: 5 + 8.
    expect(summary.currentProfit.toString()).toBe('13');
  });

  it('sums the joined offer profits, keeping the current baseline independent', () => {
    const summary = summarizeFlashSelection(rows, { a: 'h24', b: 'h24' }, {});
    expect(summary.joinedCount).toBe(2);
    // a.offer (30) + b.offer (12).
    expect(summary.joinedProfit.toString()).toBe('42');
    expect(summary.currentProfit.toString()).toBe('13');
  });

  it('totals a custom price with its captured profit instead of the offer', () => {
    // a is custom-joined at 450 whose captured estimate is 25 → total 25, not the offer's 30.
    const summary = summarizeFlashSelection(
      rows,
      {},
      { a: { price: '450.00', netProfit: '25.00', marginPct: '18.00' } },
    );
    expect(summary.joinedCount).toBe(1);
    expect(summary.joinedProfit.toString()).toBe('25');
  });

  it('ignores a null offer choice', () => {
    const summary = summarizeFlashSelection(rows, { a: null, b: 'h24' }, {});
    expect(summary.joinedCount).toBe(1);
    expect(summary.joinedProfit.toString()).toBe('12');
  });

  it('treats an uncalculable profit as zero in both totals', () => {
    const withNull: FlashProductRow[] = [makeRow('a', null, null), makeRow('b', '8', '12')];
    const summary = summarizeFlashSelection(withNull, { a: 'h24', b: 'h24' }, {});
    expect(summary.joinedCount).toBe(2);
    // a's offer profit is null → 0; b's offer is 12.
    expect(summary.joinedProfit.toString()).toBe('12');
    // a's current is null → 0; b's current is 8.
    expect(summary.currentProfit.toString()).toBe('8');
  });

  it('counts a seeded custom price with an unknown (null) profit as joined but zero-valued', () => {
    // The detail-client re-seeds a saved custom price with `netProfit: null` (the exact
    // profit for an arbitrary custom price is not in the payload). Lock that seeding
    // contract: the product still counts as joined, but contributes ZERO to the estimated
    // total until the live estimate re-confirms it.
    const summary = summarizeFlashSelection(
      rows,
      {},
      { a: { price: '150.00', netProfit: null, marginPct: null } },
    );
    expect(summary.joinedCount).toBe(1);
    expect(summary.joinedProfit.toString()).toBe('0');
  });
});
