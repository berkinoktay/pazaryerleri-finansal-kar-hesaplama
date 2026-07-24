'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import type { DiscountItemReason } from '../api/get-discount-list-detail.api';

/** The non-null not-calculable reasons (mirrors the backend `reason` enum). */
type DiscountReason = NonNullable<DiscountItemReason>;

/**
 * Returns a mapper from the backend not-calculable `reason` to a human sentence, scoped to the
 * İndirimler namespace. Shared by the breakdown modal so the seller always learns WHY a row's
 * profit is missing. Unlike the Flash vertical the İndirimler engine CAN fail to resolve a
 * reduced commission (the discounted price may fall into a band with no rate), so there is a
 * `NO_COMMISSION` branch. Concrete keys per branch — next-intl's typed `t` cannot take a union.
 *
 * The mapper is `useCallback`-stable (keyed on the stable next-intl `t`) so it can sit in a
 * table `columns` dependency list without churning it every render.
 */
export function useDiscountReasonLabel(): (reason: DiscountReason) => string {
  const t = useTranslations('discountsPage.reason');
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
          throw new Error(`Unhandled discount reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}

/**
 * İndirimler-scoped sibling of {@link useDiscountReasonLabel}: maps the not-calculable `reason`
 * to a SHORT, action-oriented empty label (e.g. "Maliyet girin") for the row's {@link
 * ProfitBadge} `emptyLabel`. A `null` reason (a calculable row) maps to `undefined` so the badge
 * keeps its mute em-dash. `useCallback`-stable so it can live in the table `columns` deps.
 */
export function useDiscountReasonEmptyLabel(): (reason: DiscountItemReason) => string | undefined {
  const t = useTranslations('discountsPage.reasonShort');
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
        case 'NO_COMMISSION':
          return t('NO_COMMISSION');
        default: {
          const _exhaustive: never = reason;
          throw new Error(`Unhandled discount reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}
