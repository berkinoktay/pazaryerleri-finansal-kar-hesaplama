'use client';

import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

/**
 * Rendered when the segment is on "Kendi Anlaşmam" (OWN_CONTRACT).
 * Excel upload is the V2 path; V1 displays a placeholder with a
 * disabled CTA so the seller understands the feature is live but
 * not yet operational on their account.
 */
export function ShippingConfigEmptyState(): React.ReactElement {
  const t = useTranslations('shipping.settings.ownContract');

  return (
    <EmptyState
      title={t('title')}
      description={t('description')}
      action={
        <Button disabled type="button">
          {t('uploadDisabled')}
        </Button>
      }
    />
  );
}
