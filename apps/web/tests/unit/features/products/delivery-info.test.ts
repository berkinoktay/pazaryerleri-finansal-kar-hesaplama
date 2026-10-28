import { describe, expect, it } from 'vitest';

import { computeDeliveryInfo, dominantDeliveryInfo } from '@/features/products/lib/format-product';

import en from '../../../../messages/en.json';
import tr from '../../../../messages/tr.json';

describe('computeDeliveryInfo', () => {
  it.each([
    { deliveryDuration: null, tier: 'unknown', days: null },
    { deliveryDuration: 0, tier: 'today', days: 0 },
    { deliveryDuration: 1, tier: 'tomorrow', days: 1 },
    { deliveryDuration: 2, tier: 'later', days: 2 },
    { deliveryDuration: 9, tier: 'later', days: 9 },
  ])('maps deliveryDuration $deliveryDuration to $tier', ({ deliveryDuration, tier, days }) => {
    expect(computeDeliveryInfo({ deliveryDuration })).toEqual({ tier, days });
  });

  it.each([-1, 1.5])('treats the out-of-range duration %s as unknown', (deliveryDuration) => {
    expect(computeDeliveryInfo({ deliveryDuration })).toEqual({ tier: 'unknown', days: null });
  });
});

describe('dominantDeliveryInfo', () => {
  it('returns no info for an empty variant list', () => {
    expect(dominantDeliveryInfo([])).toEqual({ info: null, mixed: false });
  });

  it('returns the shared info when every variant agrees', () => {
    expect(dominantDeliveryInfo([{ deliveryDuration: 0 }, { deliveryDuration: 0 }])).toEqual({
      info: { tier: 'today', days: 0 },
      mixed: false,
    });
  });

  it('treats variants without a duration as agreeing on unknown', () => {
    expect(dominantDeliveryInfo([{ deliveryDuration: null }, { deliveryDuration: null }])).toEqual({
      info: { tier: 'unknown', days: null },
      mixed: false,
    });
  });

  it('is mixed when the tiers differ', () => {
    expect(dominantDeliveryInfo([{ deliveryDuration: 0 }, { deliveryDuration: 1 }])).toEqual({
      info: null,
      mixed: true,
    });
  });

  it('is mixed when the tier matches but the day count differs', () => {
    expect(dominantDeliveryInfo([{ deliveryDuration: 2 }, { deliveryDuration: 4 }])).toEqual({
      info: null,
      mixed: true,
    });
  });

  it('is mixed when only some variants report a duration', () => {
    expect(dominantDeliveryInfo([{ deliveryDuration: 1 }, { deliveryDuration: null }])).toEqual({
      info: null,
      mixed: true,
    });
  });
});

describe('delivery badge i18n', () => {
  it.each([
    { locale: 'tr', delivery: tr.products.delivery },
    { locale: 'en', delivery: en.products.delivery },
  ])('$locale carries exactly the delivery badge labels', ({ delivery }) => {
    expect(Object.keys(delivery).sort()).toEqual(['inDays', 'mixed', 'today', 'tomorrow']);
    expect(delivery.inDays).toContain('{days}');
  });
});
