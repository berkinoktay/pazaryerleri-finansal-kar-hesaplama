'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';

import { useCampaignAccess } from '../lib/campaign-access-context';

/**
 * Quiet notice under a campaign page header for a member who cannot write: the page stays
 * readable, its write controls are hidden. Renders nothing for a member who can write.
 */
export function CampaignReadOnlyNotice(): React.ReactElement | null {
  const { canWrite } = useCampaignAccess();
  const t = useTranslations('campaignAccess');

  if (canWrite) return null;

  return (
    <Alert tone="info" size="sm" role="status">
      <AlertDescription>{t('readOnlyNotice')}</AlertDescription>
    </Alert>
  );
}
