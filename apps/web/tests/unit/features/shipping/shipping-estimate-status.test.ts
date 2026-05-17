import { describe, expect, it } from 'vitest';

import { statusToVisual } from '@/features/shipping/lib/shipping-estimate-status';

describe('statusToVisual', () => {
  it.each([
    ['OK', 'blue', 'ⓘ'],
    ['NO_DESI', 'yellow', '!'],
    ['NO_CARRIER', 'yellow', '!'],
    ['OWN_CONTRACT_EMPTY', 'gray', '●'],
    ['DESI_OVERFLOW', 'red', '!'],
  ] as const)('%s → color %s, icon %s', (status, expectedColor, expectedIcon) => {
    const visual = statusToVisual(status);
    expect(visual.iconColor).toBe(expectedColor);
    expect(visual.iconChar).toBe(expectedIcon);
  });

  it('OK has no i18nKey (happy path has no error reason)', () => {
    expect(statusToVisual('OK').i18nKey).toBeUndefined();
  });

  it('non-OK statuses expose an i18nKey under shipping.products.states.*', () => {
    expect(statusToVisual('NO_DESI').i18nKey).toBe('shipping.products.states.NO_DESI');
    expect(statusToVisual('NO_CARRIER').i18nKey).toBe('shipping.products.states.NO_CARRIER');
    expect(statusToVisual('OWN_CONTRACT_EMPTY').i18nKey).toBe(
      'shipping.products.states.OWN_CONTRACT_EMPTY',
    );
    expect(statusToVisual('DESI_OVERFLOW').i18nKey).toBe('shipping.products.states.DESI_OVERFLOW');
  });
});
