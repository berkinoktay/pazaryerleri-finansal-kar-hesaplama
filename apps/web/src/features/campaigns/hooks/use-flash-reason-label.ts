'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { FlashProductItemReason } from '../types';

/**
 * Returns a mapper from the backend not-calculable `reason` to a human sentence, scoped to
 * the Flash Products namespace. Shared by the table, the mobile cards, and the breakdown
 * modal so the seller always learns WHY a row's profit is missing. Unlike the Advantage
 * vertical there is NO `NO_COMMISSION` branch — the reduced commission always falls back to
 * the flat "Mevcut Komisyon" rate, so a row is never uncalculable for a missing commission.
 * Concrete keys per branch — next-intl's typed `t` cannot take a union.
 *
 * The mapper is `useCallback`-stable (keyed on the stable next-intl `t`) so it can sit in
 * the Flash table's `columns` dependency list without churning it every render — a fresh
 * closure here would rebuild the columns and remount the custom-price input.
 */
export function useFlashReasonLabel(): (reason: FlashProductItemReason) => string {
  const t = useTranslations('flashProductsPage.reason');
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
          throw new Error(`Unhandled flash product reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}

/**
 * Flash-scoped sibling of {@link useReasonEmptyLabel}: maps the not-calculable `reason` to a
 * SHORT, action-oriented empty label (e.g. "Maliyet girin") for the row's {@link
 * ProfitBadge} `emptyLabel`. A `null` reason (a calculable row) maps to `undefined` so the
 * badge keeps its mute em-dash.
 */
export function useFlashReasonEmptyLabel(): (
  reason: FlashProductItemReason | null,
) => string | undefined {
  const t = useTranslations('flashProductsPage.reasonShort');
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
          throw new Error(`Unhandled flash product reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}
