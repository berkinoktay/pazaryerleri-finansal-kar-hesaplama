'use client';

import { useTranslations } from 'next-intl';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { ShippingTariffSource } from '../types/shipping.types';

interface ShippingTariffSourceSegmentProps {
  value: ShippingTariffSource;
  onChange: (next: ShippingTariffSource) => void;
}

/**
 * Two-option segmented control for picking the shipping tariff source.
 * Wraps the `pill` variant of the Tabs primitive (token-driven, light
 * + dark mode shadow tuned for raised-surface contrast). The segment
 * is presentation-only — it owns no state; the parent form controls
 * the active value and reacts to changes.
 */
export function ShippingTariffSourceSegment({
  value,
  onChange,
}: ShippingTariffSourceSegmentProps): React.ReactElement {
  const t = useTranslations('shipping.settings.source');

  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as ShippingTariffSource)}>
      <TabsList className="w-full">
        <TabsTrigger value="TRENDYOL_CONTRACT" className="flex-1">
          {t('trendyol')}
        </TabsTrigger>
        <TabsTrigger value="OWN_CONTRACT" className="flex-1">
          {t('ownContract')}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
