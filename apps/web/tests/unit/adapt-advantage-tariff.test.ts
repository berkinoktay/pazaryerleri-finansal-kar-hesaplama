import { describe, expect, it } from 'vitest';

import type {
  AdvantageTariffDetail,
  AdvantageTariffDetailItem,
  AdvantageTier,
} from '@/features/campaigns/api/get-advantage-tariff-detail.api';
import { toAdvantageTariffView } from '@/features/campaigns/lib/adapt-advantage-tariff';
import { resolveBestChoice } from '@/features/campaigns/lib/best-choice';

/** One backend star tier. `commissionSource` is carried by the payload but not the row. */
function apiTier(
  key: AdvantageTier['key'],
  price: string,
  commissionPct: string | null,
  netProfit: string | null,
  marginPct: string | null,
): AdvantageTier {
  return {
    key,
    upperLimit: price,
    lowerLimit: null,
    price,
    commissionPct,
    commissionSource: 'band',
    netProfit,
    marginPct,
  };
}

// The default item: current profit is LOW (10) and the MIDDLE tier (tier2, 40) carries the
// highest tier profit — so the holistic winner resolves to tier2.
function item(overrides: Partial<AdvantageTariffDetailItem> = {}): AdvantageTariffDetailItem {
  return {
    id: 'iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii',
    barcode: '8681234567890',
    stockCode: 'SKU-1',
    productTitle: 'Test Ürün',
    imageUrl: 'https://cdn.example/urun.jpg',
    category: 'Kategori A',
    brand: 'Marka B',
    size: 'M',
    stock: 12,
    currentPrice: '150.00',
    customerPrice: '120.00',
    hasCommissionTariff: true,
    calculable: true,
    reason: null,
    current: { commissionPct: '19.00', netProfit: '10.00', marginPct: '8.00', isBest: false },
    tiers: [
      apiTier('tier1', '110.00', '15.40', '20.00', '11.00'),
      apiTier('tier2', '100.00', '14.00', '40.00', '18.00'),
      apiTier('tier3', '90.00', '12.60', '30.00', '15.00'),
    ],
    commissionBands: null,
    bestTierKey: 'tier2',
    selectedTier: 'tier2',
    customPrice: null,
    ...overrides,
  };
}

function detail(items: AdvantageTariffDetailItem[]): AdvantageTariffDetail {
  return {
    id: 'tttttttt-tttt-tttt-tttt-tttttttttttt',
    name: 'Avantajlı Ürün Etiketleri',
    exported: false,
    commissionSourceMode: 'pinned',
    commissionSource: {
      tariffId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      tariffName: 'Temmuz Komisyon',
      periodLabel: '30 Haz - 6 Tem',
      startsAt: '2026-06-30T00:00:00Z',
      endsAt: '2026-07-06T00:00:00Z',
    },
    hasUnmatchedCommissionProducts: false,
    items,
  };
}

describe('toAdvantageTariffView', () => {
  it('lifts the nested current scenario to flat row fields and renames items → rows', () => {
    const view = toAdvantageTariffView(detail([item()]));

    expect(view.rows).toHaveLength(1);
    const row = view.rows[0];

    // Nested `current.*` lifted to the flat figures the shared cells + winner resolver read.
    expect(row.currentCommissionPct).toBe('19.00');
    expect(row.currentNetProfit).toBe('10.00');
    expect(row.currentMarginPct).toBe('8.00');

    // The buyer-facing price + the passthrough identity fields survive verbatim.
    expect(row.customerPrice).toBe('120.00');
    expect(row.currentPrice).toBe('150.00');
    expect(row.size).toBe('M');
    expect(row.stock).toBe(12);
    expect(row.hasCommissionTariff).toBe(true);

    // Server-authoritative seed fields for the edit buffer.
    expect(row.selectedTier).toBe('tier2');
    expect(row.customPrice).toBeNull();
  });

  it('folds every star tier into a band-like candidate (target price + reduced commission)', () => {
    const row = toAdvantageTariffView(detail([item()])).rows[0];

    expect(row.bands.map((b) => b.key)).toEqual(['tier1', 'tier2', 'tier3']);
    // The tier's `price` (target) + `commissionPct` / `netProfit` / `marginPct` carry over;
    // `upperLimit` / `lowerLimit` / `commissionSource` are NOT part of the band shape.
    expect(row.bands[1]).toEqual({
      key: 'tier2',
      price: '100.00',
      commissionPct: '14.00',
      netProfit: '40.00',
      marginPct: '18.00',
    });
  });

  it('passes the commission-band ladder through verbatim (array and null)', () => {
    // A band-sourced item carries its ladder; a category-sourced item carries null.
    const banded = toAdvantageTariffView(
      detail([
        item({
          commissionBands: [
            { lowerLimit: '300.00', upperLimit: null, commissionPct: '19.0000' },
            { lowerLimit: null, upperLimit: '299.99', commissionPct: '8.8000' },
          ],
        }),
      ]),
    ).rows[0];
    expect(banded.commissionBands).toEqual([
      { lowerLimit: '300.00', upperLimit: null, commissionPct: '19.0000' },
      { lowerLimit: null, upperLimit: '299.99', commissionPct: '8.8000' },
    ]);

    const category = toAdvantageTariffView(detail([item({ commissionBands: null })])).rows[0];
    expect(category.commissionBands).toBeNull();
  });

  it('carries a variable number of tiers (0–3) and drops any null-key tier', () => {
    // One-tier product.
    const oneTier = toAdvantageTariffView(
      detail([item({ tiers: [apiTier('tier1', '110.00', '15.40', '20.00', '11.00')] })]),
    ).rows[0];
    expect(oneTier.bands).toHaveLength(1);
    expect(oneTier.bands[0].key).toBe('tier1');

    // Zero-tier product (no tier qualified).
    const noTier = toAdvantageTariffView(detail([item({ tiers: [] })])).rows[0];
    expect(noTier.bands).toHaveLength(0);

    // A defensive null-key tier is dropped, keeping only the concrete star tiers.
    const withNullKey = toAdvantageTariffView(
      detail([
        item({
          tiers: [
            apiTier('tier1', '110.00', '15.40', '20.00', '11.00'),
            apiTier(null, '105.00', '15.00', '18.00', '10.00'),
            apiTier('tier3', '90.00', '12.60', '30.00', '15.00'),
          ],
        }),
      ]),
    ).rows[0];
    expect(withNullKey.bands.map((b) => b.key)).toEqual(['tier1', 'tier3']);
  });

  it('lifts the commission-source meta + exported flag to the view', () => {
    const view = toAdvantageTariffView(detail([item()]));
    expect(view.exported).toBe(false);
    expect(view.commissionSourceMode).toBe('pinned');
    expect(view.commissionSource?.tariffName).toBe('Temmuz Komisyon');
    expect(view.hasUnmatchedCommissionProducts).toBe(false);
  });

  it('produces a row that satisfies BestChoiceRow (feeds the shared winner resolver)', () => {
    const row = toAdvantageTariffView(detail([item()])).rows[0];
    // The adapted row's `currentNetProfit` + `bands[{key, netProfit}]` are exactly what
    // resolveBestChoice ranks — tier2 (40) strictly beats every other tier and the current
    // price (10), so it is the holistic winner.
    expect(resolveBestChoice(row, null)).toBe('tier2');
  });
});
