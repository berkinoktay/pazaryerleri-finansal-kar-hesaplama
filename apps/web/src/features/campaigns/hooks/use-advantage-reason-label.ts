'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { AdvantageTariffItemReason } from '../types';

/**
 * Returns a mapper from the backend not-calculable `reason` to a human sentence
 * (e.g. "Komisyon oranı çözülemedi — bu döneme ait Ürün Komisyon Excel'ini yükleyin."),
 * scoped to the Advantage tariff namespace. Shared by the table, the mobile cards, and
 * the breakdown modal so the seller always learns WHY a product's profit is missing.
 * Unlike the commission/Plus verticals this adds the `NO_COMMISSION` branch (the tier
 * price landed in neither a commission band nor a resolvable category rate). Concrete
 * keys per branch — next-intl's typed `t` cannot take a union.
 *
 * The mapper is `useCallback`-stable (keyed on the stable next-intl `t`) so it can sit in
 * the Advantage table's `columns` dependency list without churning it every render.
 * Mirrors {@link usePlusReasonLabel}: the table relies on this to keep its TanStack
 * columns from rebuilding (and remounting the custom-price input) when unrelated parent
 * state changes — a fresh closure here defeats the whole remount fix.
 */
export function useAdvantageReasonLabel(): (reason: AdvantageTariffItemReason) => string {
  const t = useTranslations('productLabelsPage.reason');
  return React.useCallback(
    (reason) => {
      switch (reason) {
        case 'NO_PRODUCT':
          return t('NO_PRODUCT');
        case 'NO_COST':
          return t('NO_COST');
        case 'NO_SHIPPING':
          return t('NO_SHIPPING');
        case 'NO_COMMISSION':
          return t('NO_COMMISSION');
        default: {
          const _exhaustive: never = reason;
          throw new Error(`Unhandled advantage tariff reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}
