'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/patterns/empty-state';

import type { Store } from '../api/members.api';
import { useMembers } from '../hooks/use-members';
import { MembersTable } from './members-table';

interface MembersSettingsPageClientProps {
  orgId: string | null;
  /** Resolved server-side from the caller's capabilities (members:read). */
  canReadRoster: boolean;
  /** Org stores, fetched server-side — the managing caller (OWNER/ADMIN) sees all. */
  stores: Store[];
}

export function MembersSettingsPageClient({
  orgId,
  canReadRoster,
  stores,
}: MembersSettingsPageClientProps): ReactElement {
  const t = useTranslations('settings.members');
  const membersQuery = useMembers(canReadRoster ? orgId : null);

  if (!canReadRoster || orgId === null) {
    return (
      <EmptyState
        title={t('noPermission.title')}
        description={t('noPermission.description')}
        className="max-w-form"
      />
    );
  }

  if (membersQuery.isError) {
    return (
      <EmptyState
        title={t('error.title')}
        description={t('error.description')}
        className="max-w-form"
      />
    );
  }

  // While the roster loads, the table keeps its real header and renders
  // skeleton rows in place — no bare loading text, no layout swap.
  return (
    <MembersTable
      orgId={orgId}
      members={membersQuery.data ?? []}
      stores={stores}
      loading={membersQuery.isPending}
    />
  );
}
