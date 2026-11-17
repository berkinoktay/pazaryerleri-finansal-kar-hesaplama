import { describe, expect, it } from 'vitest';

import type { PlusTariffDetail } from '@/features/campaigns/api/get-plus-tariff-detail.api';
import { toPlusTariffView } from '@/features/campaigns/lib/adapt-plus-tariff';

/**
 * One detail item whose committed custom Plus price (80) sits BELOW the ceiling (100),
 * and whose `plus.price` is deliberately set to the custom value — the shape a naive
 * backend (or the old bug) would emit. The adapter must still read the ceiling from the
 * dedicated `plusPriceUpperLimit` ground-truth field, never `plus.price`.
 */
function detailWithCustomBelowCeiling(): PlusTariffDetail {
  return {
    id: 'tttttttt-tttt-tttt-tttt-tttttttttttt',
    name: 'Plus 7 Günlük',
    exported: false,
    periods: [
      {
        id: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
        dateRangeLabel: '30 Haz - 6 Tem',
        dayCount: 7,
        validity: 'active',
        items: [
          {
            id: 'iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii',
            barcode: '8681234567890',
            stockCode: 'SKU-1',
            productTitle: 'Test Ürün',
            imageUrl: null,
            category: 'Kategori A',
            brand: 'Marka B',
            currentPrice: '120.00',
            commissionBasePrice: '120.00',
            currentCommissionPct: '19.00',
            currentNetProfit: '10.00',
            currentMarginPct: '8.00',
            plusPriceUpperLimit: '100.00',
            // Decoy: a naive payload could echo the custom price here — the adapter must
            // ignore it in favour of `plusPriceUpperLimit`.
            plus: {
              price: '80.00',
              commissionPct: '15.40',
              netProfit: '12.00',
              marginPct: '11.00',
            },
            plusIsBetter: true,
            calculable: true,
            reason: null,
            selected: false,
            customPrice: '80.00',
          },
        ],
      },
    ],
  };
}

type PlusDetailItem = PlusTariffDetail['periods'][number]['items'][number];

/** The base fixture with its single item's fields overridden. */
function detailWithItem(overrides: Partial<PlusDetailItem>): PlusTariffDetail {
  const detail = detailWithCustomBelowCeiling();
  const period = detail.periods[0];
  const item = period?.items[0];
  if (period === undefined || item === undefined) {
    throw new Error('fixture must hold one period with one item');
  }
  return { ...detail, periods: [{ ...period, items: [{ ...item, ...overrides }] }] };
}

describe('toPlusTariffView — unknown prices stay null', () => {
  it('maps a null plusPriceUpperLimit to a null offer price', () => {
    const view = toPlusTariffView(
      detailWithItem({
        plusPriceUpperLimit: null,
        plus: { price: null, commissionPct: '15.40', netProfit: null, marginPct: null },
        plusIsBetter: false,
      }),
    );
    const offer = view.periods[0]?.rows[0]?.bands[0];

    expect(offer?.price).toBeNull();
    expect(offer?.netProfit).toBeNull();
    expect(offer?.marginPct).toBeNull();
    expect(offer?.commissionPct).toBe('15.40');
  });

  it('keeps null current and commission base prices', () => {
    const view = toPlusTariffView(
      detailWithItem({
        currentPrice: null,
        commissionBasePrice: null,
        currentNetProfit: null,
        currentMarginPct: null,
        calculable: false,
        reason: null,
      }),
    );
    const row = view.periods[0]?.rows[0];

    expect(row?.currentPrice).toBeNull();
    expect(row?.commissionBasePrice).toBeNull();
    expect(row?.currentNetProfit).toBeNull();
    // The ceiling is untouched by an unknown current price.
    expect(row?.bands[0]?.price).toBe('100.00');
  });

  it('keeps a null current commission and a null offer commission', () => {
    const view = toPlusTariffView(
      detailWithItem({
        currentCommissionPct: null,
        currentNetProfit: null,
        currentMarginPct: null,
        plus: { price: '100.00', commissionPct: null, netProfit: null, marginPct: null },
        plusIsBetter: false,
        calculable: false,
        reason: null,
      }),
    );
    const row = view.periods[0]?.rows[0];
    const offer = row?.bands[0];

    expect(row?.currentCommissionPct).toBeNull();
    expect(row?.currentNetProfit).toBeNull();
    expect(offer?.commissionPct).toBeNull();
    expect(offer?.netProfit).toBeNull();
    // The prices are kept: only the percents are unknown.
    expect(row?.commissionBasePrice).toBe('120.00');
    expect(offer?.price).toBe('100.00');
  });
});

describe('toPlusTariffView — offer band price is the ceiling ground truth', () => {
  it('reads the offer price from plusPriceUpperLimit, not plus.price', () => {
    const view = toPlusTariffView(detailWithCustomBelowCeiling());
    const row = view.periods[0]?.rows[0];
    const offer = row?.bands[0];

    // The offer band's price is the true ceiling (100), NOT the committed custom price
    // (80) some backends echo in `plus.price`. The custom-price cell derives its input
    // `max` from `plusOffer(row).price`, so this is exactly what lets the seller raise a
    // saved custom price back up to the real ceiling.
    expect(offer?.price).toBe('100.00');
    expect(offer?.price).not.toBe('80.00');

    // `plus.*` still supplies the scenario figures (commission %, profit, margin).
    expect(offer?.commissionPct).toBe('15.40');
    expect(offer?.netProfit).toBe('12.00');
    expect(offer?.marginPct).toBe('11.00');

    // The committed custom price is preserved on the row so the input can re-seed to it.
    expect(row?.customPrice).toBe('80.00');
  });
});
