import { describe, expect, it } from 'vitest';

import type {
  FlashOffer,
  FlashProductDetail,
  FlashProductDetailItem,
} from '@/features/campaigns/api/get-flash-product-detail.api';
import { offerKeyFromEnum, toFlashProductView } from '@/features/campaigns/lib/adapt-flash-product';
import { resolveBestChoice } from '@/features/campaigns/lib/best-choice';
import { flashCustomCeiling } from '@/features/campaigns/lib/flash-bulk-actions';

/** One dated flash offer (24 Saatlik / 3 Saatlik) as the backend serves it. */
function apiOffer(overrides: Partial<NonNullable<FlashOffer>> = {}): FlashOffer {
  return {
    price: '600.00',
    startsAt: '2026-07-08T00:00:00Z',
    endsAt: '2026-07-08T23:59:00Z',
    validity: 'active',
    commissionPct: '13.10',
    netProfit: '30.00',
    marginPct: '10.00',
    ...overrides,
  };
}

// The default item carries BOTH offers: a cheaper 24 Saatlik (600) and a dearer 3 Saatlik
// (650), so the custom-price ceiling (min offer price) resolves to the 24 Saatlik price.
function item(overrides: Partial<FlashProductDetailItem> = {}): FlashProductDetailItem {
  return {
    id: 'iiiiiiii-iiii-iiii-iiii-iiiiiiiiiiii',
    barcode: '8681234567890',
    modelCode: 'MODEL-1',
    productTitle: 'Test Ürün',
    imageUrl: 'https://cdn.example/urun.jpg',
    category: 'Kategori A',
    brand: 'Marka B',
    stock: 12,
    externalId: 'ext-1',
    currentPrice: '800.00',
    customerPrice: '800.00',
    currentCommissionPct: '19.00',
    currentNetProfit: '50.00',
    currentMarginPct: '6.25',
    calculable: true,
    reason: null,
    hasCommissionTariff: true,
    commissionSource: 'band',
    commissionBands: null,
    offer24: apiOffer({ price: '600.00', netProfit: '30.00' }),
    offer3: apiOffer({ price: '650.00', netProfit: '20.00', validity: 'upcoming' }),
    selectedOffer: null,
    customPrice: null,
    ...overrides,
  };
}

function detail(items: FlashProductDetailItem[]): FlashProductDetail {
  return {
    id: 'llllllll-llll-llll-llll-llllllllllll',
    name: 'Temmuz Flaş Ürünleri',
    exported: false,
    items,
  };
}

describe('toFlashProductView', () => {
  it('lifts the flat current fields, renames items → rows, and passes identity fields through', () => {
    const view = toFlashProductView(detail([item()]));

    expect(view.id).toBe('llllllll-llll-llll-llll-llllllllllll');
    expect(view.name).toBe('Temmuz Flaş Ürünleri');
    expect(view.exported).toBe(false);
    expect(view.rows).toHaveLength(1);

    const row = view.rows[0];
    expect(row.currentCommissionPct).toBe('19.00');
    expect(row.currentNetProfit).toBe('50.00');
    expect(row.currentMarginPct).toBe('6.25');
    expect(row.customerPrice).toBe('800.00');
    expect(row.currentPrice).toBe('800.00');
    expect(row.modelCode).toBe('MODEL-1');
    expect(row.stock).toBe(12);
    expect(row.hasCommissionTariff).toBe(true);
    expect(row.commissionSource).toBe('band');
    // Server-authoritative seed fields for the edit buffer.
    expect(row.selectedOffer).toBeNull();
    expect(row.customPrice).toBeNull();
  });

  it('folds every present offer into a band-like candidate, 24 Saatlik before 3 Saatlik', () => {
    const row = toFlashProductView(detail([item()])).rows[0];

    expect(row.bands.map((b) => b.key)).toEqual(['h24', 'h3']);
    // Each band carries the offer's flash price + reduced commission + backend profit/margin
    // PLUS its dated window (startsAt/endsAt/validity) — the shape the shared cells consume.
    expect(row.bands[0]).toEqual({
      key: 'h24',
      price: '600.00',
      commissionPct: '13.10',
      netProfit: '30.00',
      marginPct: '10.00',
      startsAt: '2026-07-08T00:00:00Z',
      endsAt: '2026-07-08T23:59:00Z',
      validity: 'active',
    });
    expect(row.bands[1].key).toBe('h3');
    expect(row.bands[1].validity).toBe('upcoming');
  });

  it('derives flashDay from the primary window (offer24 ?? offer3), or null when no offer has one', () => {
    // Both offers present → the primary (24 Saatlik) window's start is the row's day.
    const both = toFlashProductView(detail([item()])).rows[0];
    expect(both.flashDay).toBe('2026-07-08T00:00:00Z');

    // Only 3 Saatlik present → its window's start becomes the row's day.
    const only3 = toFlashProductView(
      detail([item({ offer24: null, offer3: apiOffer({ startsAt: '2026-07-09T00:00:00Z' }) })]),
    ).rows[0];
    expect(only3.flashDay).toBe('2026-07-09T00:00:00Z');

    // Neither offer present → null (no day chip to show).
    const none = toFlashProductView(detail([item({ offer24: null, offer3: null })])).rows[0];
    expect(none.flashDay).toBeNull();
  });

  it('drops an absent offer so the band-presence flags reflect which offers exist', () => {
    // Only 24 Saatlik present → one band (a data set of these rows would hide the 3 Saatlik
    // column).
    const only24 = toFlashProductView(detail([item({ offer3: null })])).rows[0];
    expect(only24.bands.map((b) => b.key)).toEqual(['h24']);

    // Only 3 Saatlik present → one band, keyed h3.
    const only3 = toFlashProductView(detail([item({ offer24: null })])).rows[0];
    expect(only3.bands.map((b) => b.key)).toEqual(['h3']);

    // Neither offer present → an empty bands array (both columns would hide for such rows).
    const none = toFlashProductView(detail([item({ offer24: null, offer3: null })])).rows[0];
    expect(none.bands).toHaveLength(0);
  });

  it('passes the commission-band ladder through verbatim (array and null)', () => {
    const banded = toFlashProductView(
      detail([
        item({
          commissionBands: [
            { lowerLimit: '450.00', upperLimit: null, commissionPct: '19.0000' },
            { lowerLimit: null, upperLimit: '449.99', commissionPct: '13.1000' },
          ],
        }),
      ]),
    ).rows[0];
    expect(banded.commissionBands).toEqual([
      { lowerLimit: '450.00', upperLimit: null, commissionPct: '19.0000' },
      { lowerLimit: null, upperLimit: '449.99', commissionPct: '13.1000' },
    ]);

    const flat = toFlashProductView(detail([item({ commissionBands: null })])).rows[0];
    expect(flat.commissionBands).toBeNull();
  });

  it('carries an uncalculable row through as null profit/margin with its reason', () => {
    const row = toFlashProductView(
      detail([
        item({
          calculable: false,
          reason: 'NO_COST',
          currentNetProfit: null,
          currentMarginPct: null,
          offer24: apiOffer({ price: '600.00', netProfit: null, marginPct: null }),
          offer3: null,
        }),
      ]),
    ).rows[0];
    expect(row.calculable).toBe(false);
    expect(row.reason).toBe('NO_COST');
    expect(row.currentNetProfit).toBeNull();
    expect(row.bands[0].netProfit).toBeNull();
  });

  it('produces a row that feeds the shared winner resolver (current 50 beats both low offers)', () => {
    const row = toFlashProductView(detail([item()])).rows[0];
    // current (50) strictly beats both offers (30 / 20) → keeping the current price wins.
    expect(resolveBestChoice(row, null)).toBe('current');
  });
});

describe('offerKeyFromEnum', () => {
  it('maps the backend selectedOffer enum to the client offer key (null → null)', () => {
    expect(offerKeyFromEnum('H24')).toBe('h24');
    expect(offerKeyFromEnum('H3')).toBe('h3');
    expect(offerKeyFromEnum(null)).toBeNull();
  });
});

describe('flashCustomCeiling', () => {
  it('is the LOWEST present offer price (min over the offers that exist)', () => {
    // 24 Saatlik 600, 3 Saatlik 650 → ceiling 600 (the best offer the seller was given).
    const row = toFlashProductView(detail([item()])).rows[0];
    expect(flashCustomCeiling(row)?.toString()).toBe('600');
  });

  it('follows the single present offer when only one exists', () => {
    const only3 = toFlashProductView(
      detail([item({ offer24: null, offer3: apiOffer({ price: '450.00' }) })]),
    ).rows[0];
    expect(flashCustomCeiling(only3)?.toString()).toBe('450');
  });

  it('is null when the row carries no offer at all', () => {
    const none = toFlashProductView(detail([item({ offer24: null, offer3: null })])).rows[0];
    expect(flashCustomCeiling(none)).toBeNull();
  });
});
