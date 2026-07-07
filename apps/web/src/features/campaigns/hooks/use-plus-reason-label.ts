'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { TariffItemReason } from './use-reason-label';

/**
 * Returns a mapper from the backend not-calculable `reason` to a human sentence
 * (e.g. "Maliyet yok - bu urune bir maliyet profili ekleyin."), scoped to the
 * Plus tariff namespace. Shared by the table, the mobile cards, and the breakdown
 * modal so the seller always learns WHY a product's profit is missing. Concrete
 * keys per branch - next-intl's typed `t` cannot take a union.
 *
 * The mapper is `useCallback`-stable (keyed on the stable next-intl `t`) so it can
 * sit in the Plus table's `columns` dependency list without churning it every render.
 * Mirrors {@link useReasonLabel}: the table relies on this to keep its TanStack
 * columns from rebuilding (and remounting the custom-price input) when unrelated
 * parent state changes — a fresh closure here defeats the whole remount fix.
 */
export function usePlusReasonLabel(): (reason: TariffItemReason) => string {
  const t = useTranslations('plusCommissionTariffsPage.reason');
  return React.useCallback(
    (reason) => {
      switch (reason) {
        case 'NO_PRODUCT':
          return t('NO_PRODUCT');
        case 'NO_COST':
          return t('NO_COST');
        case 'NO_SHIPPING':
          return t('NO_SHIPPING');
        default: {
          const _exhaustive: never = reason;
          throw new Error(`Unhandled plus tariff reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}

/**
 * Plus-scoped sibling of {@link useReasonEmptyLabel}: maps the not-calculable `reason` to a
 * SHORT, action-oriented empty label (e.g. "Maliyet girin") for the row's {@link
 * ProfitBadge} `emptyLabel`. A `null` reason (a calculable row) maps to `undefined` so the
 * badge keeps its mute em-dash.
 */
export function usePlusReasonEmptyLabel(): (reason: TariffItemReason | null) => string | undefined {
  const t = useTranslations('plusCommissionTariffsPage.reasonShort');
  return React.useCallback(
    (reason) => {
      if (reason === null) return undefined;
      switch (reason) {
        case 'NO_PRODUCT':
          return t('NO_PRODUCT');
        case 'NO_COST':
          return t('NO_COST');
        case 'NO_SHIPPING':
          return t('NO_SHIPPING');
        default: {
          const _exhaustive: never = reason;
          throw new Error(`Unhandled plus tariff reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}
