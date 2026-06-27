import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactElement } from 'react';

import type { Store } from '@/features/members/api/members.api';
import { InviteMemberButton } from '@/features/members/components/invite-member-button';
import { MembersSettingsPageClient } from '@/features/members/components/members-settings-page-client';
import { routing } from '@/i18n/routing';
import { resolveActiveOrgId } from '@/lib/active-org';
import { getServerApiClient } from '@/lib/api-client/server';

import { SettingsPageShell } from '../settings-page-shell';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: effectiveLocale, namespace: 'settings.members' });
  return { title: t('title') };
}

/**
 * Members settings page (server shell). Resolves the active org, then asks the
 * membership-context endpoint whether the caller may read the roster
 * (`members:read`) — the client renders the table or a no-permission state
 * accordingly. The backend independently enforces every member mutation.
 */
export default async function SettingsMembersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ReactElement> {
  const { locale } = await params;
  const effectiveLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const tMembers = await getTranslations({
    locale: effectiveLocale,
    namespace: 'settings.members',
  });

  const api = await getServerApiClient();
  const { data: orgsResponse } = await api.GET('/v1/organizations', {});
  const orgs = orgsResponse?.data ?? [];
  const activeOrgId = await resolveActiveOrgId(orgs);

  let canReadRoster = false;
  let stores: Store[] = [];
  if (activeOrgId !== undefined) {
    const { data: me } = await api.GET('/v1/organizations/{orgId}/me', {
      params: { path: { orgId: activeOrgId } },
    });
    canReadRoster = me?.capabilities.includes('members:read') ?? false;

    if (canReadRoster) {
      // The managing caller (OWNER/ADMIN) sees every store — the full set the
      // store-access checklist needs.
      const { data: storesResponse } = await api.GET('/v1/organizations/{orgId}/stores', {
        params: { path: { orgId: activeOrgId } },
      });
      stores = storesResponse?.data ?? [];
    }
  }

  return (
    <SettingsPageShell
      title={tMembers('title')}
      intent={tMembers('intent')}
      actions={canReadRoster ? <InviteMemberButton /> : undefined}
    >
      <MembersSettingsPageClient
        orgId={activeOrgId ?? null}
        canReadRoster={canReadRoster}
        stores={stores}
      />
    </SettingsPageShell>
  );
}
