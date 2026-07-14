'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { SettingsAsideCard } from '@/components/patterns/settings-section';
import { DOMAIN_ICONS } from '@/lib/domain-icons';
import { useCurrentScope } from '@/providers/current-scope';

// Role key is inferred; the `role` from useCurrentScope drives the type, so we
// don't reach across into the organization feature just for the role union.
const ROLE_KEY = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;

export interface AccountSummaryCardProps {
  email: string;
  fullName: string | null;
  /** ISO timestamp of account creation, for the "member since" line. */
  createdAt: string | null;
}

/**
 * Contextual aside for the Profil page — a compact account summary (avatar,
 * identity, role, membership, connected-store count) plus a nudge. Reads role
 * and store access from the current scope; the rest comes from props the
 * server page already fetched. Display-only: no actions, no mutations.
 */
export function AccountSummaryCard({
  email,
  fullName,
  createdAt,
}: AccountSummaryCardProps): React.ReactElement {
  const t = useTranslations('settings.profile.summary');
  const tRoles = useTranslations('common.roles');
  const format = useFormatter();
  const { role, accessibleStores } = useCurrentScope();

  const displayName = (fullName ?? '').trim();
  const membership = createdAt !== null ? format.dateTime(new Date(createdAt), 'month') : '—';

  const rows = [
    { key: 'role', label: t('role'), value: tRoles(ROLE_KEY[role]) },
    { key: 'membership', label: t('membership'), value: membership },
    { key: 'stores', label: t('stores'), value: String(accessibleStores.length) },
  ];

  return (
    <>
      <SettingsAsideCard title={t('title')} icon={<DOMAIN_ICONS.profile />}>
        <div className="gap-md flex flex-col">
          <div className="gap-2xs pt-2xs flex flex-col items-center text-center">
            <span className="text-foreground text-sm font-semibold">
              {displayName.length > 0 ? displayName : email}
            </span>
            {displayName.length > 0 ? (
              <span className="text-muted-foreground text-2xs">{email}</span>
            ) : null}
            <Badge tone="success" className="mt-3xs">
              {t('active')}
            </Badge>
          </div>
          <dl className="flex flex-col">
            {rows.map((row) => (
              <div
                key={row.key}
                className="border-border-muted py-xs flex items-center justify-between border-t text-sm"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="text-foreground font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </SettingsAsideCard>

      <SettingsAsideCard title={t('tipTitle')} icon={<DOMAIN_ICONS.hint />}>
        <p className="text-muted-foreground text-2xs leading-relaxed">{t('tipBody')}</p>
      </SettingsAsideCard>
    </>
  );
}
