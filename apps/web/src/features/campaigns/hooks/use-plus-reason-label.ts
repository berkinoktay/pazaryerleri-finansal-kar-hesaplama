'use client';

import { useTranslations } from 'next-intl';

import type { TariffItemReason } from './use-reason-label';

/**
 * Returns a mapper from the backend not-calculable `reason` to a human sentence
 * (e.g. "Maliyet yok - bu urune bir maliyet profili ekleyin."), scoped to the
 * Plus tariff namespace. Shared by the offer cell, the table, the mobile cards,
 * and the breakdown modal so the seller always learns WHY a product's profit is
 * missing. Concrete keys per branch - next-intl's typed `t` cannot take a union.
 */
export function usePlusReasonLabel(): (reason: TariffItemReason) => string {
  const t = useTranslations('plusCommissionTariffsPage.reason');
  return (reason) => {
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
  };
}
