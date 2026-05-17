import type { ShippingTariffApplied } from '../types/shipping.types';

/**
 * Render the carrier+lane chip shown alongside the "Kargo" row in the
 * net-profit popover. Returns `null` when either field is missing — the
 * popover suppresses the chip rather than printing a partial label.
 *
 * Lane copy stays inline (not localized) because these are upstream
 * Trendyol carrier codes (SENDEOMP, ARASMP, …) plus a single Turkish
 * lane label. If the carrier-chip surface ever leaves Turkish-only
 * territory, fold it into a `useTranslations` consumer at the call site.
 */
export function formatCarrierChip(
  code: string | null,
  tariff: ShippingTariffApplied | null,
): string | null {
  if (code === null || tariff === null) return null;
  if (tariff === 'OWN_CONTRACT') return 'Kendi anlaşma';
  return `${code} · ${tariff === 'BAREM' ? 'Barem desteği' : 'Normal'}`;
}
