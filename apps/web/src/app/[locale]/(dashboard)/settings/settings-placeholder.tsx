import { type Locale } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/patterns/empty-state';
import { FeatureStatusMarker } from '@/components/patterns/feature-status-marker';
import { PageHeader } from '@/components/patterns/page-header';

import type { SettingsItemStatus } from './settings-nav-config';

/**
 * Standard body for a settings sub-page whose UI isn't built out yet.
 * Renders the page header (with a developer-only draft marker when the
 * page's backend isn't wired) above the shared "coming soon" empty state.
 * Phase 1–3 replace these with real forms; the nav already lists every
 * page so the full settings surface is visible from day one.
 */
export async function SettingsPlaceholder({
  locale,
  title,
  status,
}: {
  locale: Locale;
  title: string;
  status: SettingsItemStatus;
}): Promise<React.ReactElement> {
  const tEmpty = await getTranslations({ locale, namespace: 'placeholderPage' });

  return (
    <>
      <PageHeader
        title={title}
        meta={
          status === 'draft' ? <FeatureStatusMarker status={status} variant="badge" /> : undefined
        }
      />
      <EmptyState title={tEmpty('comingSoon')} description={tEmpty('description')} />
    </>
  );
}
