'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

/** Why a tariff row cannot be costed (mirrors the backend `reason` enum). */
export type TariffItemReason = 'NO_PRODUCT' | 'NO_COST' | 'NO_SHIPPING';

/**
 * Returns a mapper from the backend not-calculable `reason` to a human sentence
 * (e.g. "Maliyet yok — bu ürüne bir maliyet profili ekleyin."). Shared by the
 * band table, the mobile cards, and the breakdown modal so the seller always
 * learns WHY a product's profit is missing, not just that it is. Concrete keys
 * per branch — next-intl's typed `t` cannot take a union argument.
 *
 * The mapper is `useCallback`-stable (keyed on the stable next-intl `t`) so it can
 * sit in a `useMemo`/`columns` dependency list without churning it every render —
 * the tariff table relies on this to keep its TanStack columns from rebuilding (and
 * remounting the custom-price input) when unrelated parent state changes.
 */
export function useReasonLabel(): (reason: TariffItemReason) => string {
  const t = useTranslations('commissionTariffsPage.reason');
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
          throw new Error(`Unhandled tariff reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}

/**
 * Returns a mapper from the not-calculable `reason` to a SHORT, action-oriented empty
 * label (e.g. "Maliyet girin") for the row's {@link ProfitBadge} `emptyLabel`. A `null`
 * reason (a calculable row) maps to `undefined` so the badge keeps its mute em-dash. This
 * is the compact sibling of {@link useReasonLabel}'s full sentence (used in the breakdown
 * modal) — the current/custom cells feed it into the badge so the "why it can't be costed"
 * signal rides the warning-soft chip instead of a separate inline line.
 */
export function useReasonEmptyLabel(): (reason: TariffItemReason | null) => string | undefined {
  const t = useTranslations('commissionTariffsPage.reasonShort');
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
          throw new Error(`Unhandled tariff reason: ${String(_exhaustive)}`);
        }
      }
    },
    [t],
  );
}
