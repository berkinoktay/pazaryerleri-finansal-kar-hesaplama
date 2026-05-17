'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ShippingConfigForm } from '@/features/shipping/components/shipping-config-form';

import { StoresEmptyState } from './stores-empty-state';

interface StoreOption {
  id: string;
  name: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
}

export interface StoresSettingsPageClientProps {
  orgId: string | null;
  activeStoreId: string | null;
  stores: StoreOption[];
}

/**
 * Client shell for the Stores settings page. Owns:
 *
 *   - Empty state when the user has zero stores (CTA → connect modal).
 *   - Store picker when there are 2+ stores (selecting auto-rebinds
 *     the embedded forms; the active-store cookie isn't touched here
 *     because settings is a passive surface — the dashboard rail
 *     remains the canonical place to switch stores app-wide).
 *   - The "Kargo" section, embedding `ShippingConfigForm` from the
 *     shipping feature (an audited cross-feature consumer — see
 *     scripts/audit-feature-boundaries.config.ts).
 *
 * Future sections (notification routing per store, default cost
 * profile, etc.) will compose onto the same column.
 */
export function StoresSettingsPageClient({
  orgId,
  activeStoreId,
  stores,
}: StoresSettingsPageClientProps): React.ReactElement {
  const t = useTranslations('settings.nav');
  const tStores = useTranslations('stores');

  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(
    activeStoreId ?? stores[0]?.id ?? null,
  );

  if (orgId === null) {
    return <EmptyState title={tStores('panel.title')} description={tStores('connect.subtitle')} />;
  }

  if (stores.length === 0) {
    return <StoresEmptyState orgId={orgId} />;
  }

  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? stores[0];
  if (selectedStore === undefined) {
    return <StoresEmptyState orgId={orgId} />;
  }

  return (
    <div className="gap-xl flex flex-col">
      {stores.length > 1 ? (
        <div className="gap-2xs flex flex-col">
          <span className="text-2xs text-muted-foreground font-semibold tracking-wide uppercase">
            {t('stores')}
          </span>
          <Select value={selectedStore.id} onValueChange={(next) => setSelectedStoreId(next)}>
            <SelectTrigger className="max-w-form" aria-label={t('stores')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stores.map((store) => (
                <SelectItem key={store.id} value={store.id}>
                  {store.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <ShippingConfigForm
        orgId={orgId}
        storeId={selectedStore.id}
        platform={selectedStore.platform}
      />
    </div>
  );
}
