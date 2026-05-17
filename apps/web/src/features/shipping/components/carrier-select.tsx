'use client';

import { useTranslations } from 'next-intl';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { ShippingCarrier } from '../types/shipping.types';

interface CarrierSelectProps {
  carriers: ShippingCarrier[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}

/**
 * Dropdown of marketplace carriers. Carriers without Barem support get
 * a muted "(Barem destek dışı)" suffix so sellers see up-front which
 * carrier choices cap their Trendyol-side discount programs.
 *
 * Sorting is the responsibility of the backend (`sortOrder ASC`) — the
 * component renders the array as received.
 */
export function CarrierSelect({
  carriers,
  value,
  onChange,
  disabled,
  invalid,
}: CarrierSelectProps): React.ReactElement {
  const t = useTranslations('shipping.settings');

  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger invalid={invalid} aria-label={t('carrierLabel')}>
        <SelectValue placeholder={t('carrierPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        {carriers.map((carrier) => (
          <SelectItem key={carrier.id} value={carrier.id}>
            {carrier.displayName}
            {!carrier.supportsBaremDestek ? (
              <span className="text-muted-foreground ml-xs text-xs">{t('barem')}</span>
            ) : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
