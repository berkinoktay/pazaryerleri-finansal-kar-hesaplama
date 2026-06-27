'use client';

import { useTranslations } from 'next-intl';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { useCurrentScope } from '@/providers/current-scope';

const ROLE_KEY = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const satisfies Record<'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER', string>;

/**
 * Contextual aside for the Genel (organization) settings page.
 * Display-only: shows a compact summary of the current organization
 * (name, role, connected store count, plan) plus a short tip card.
 * Reads live data from the current scope — no props needed.
 */
export function OrganizationSummaryCard(): React.ReactElement {
  const t = useTranslations('settings.organization.summary');
  const tRoles = useTranslations('settings.members.roles');
  const { org, role, accessibleStores } = useCurrentScope();

  const orgInitials = org.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const rows = [
    { key: 'orgName', label: t('orgName'), value: org.name },
    { key: 'role', label: t('role'), value: tRoles(ROLE_KEY[role]) },
    { key: 'stores', label: t('stores'), value: String(accessibleStores.length) },
    { key: 'plan', label: t('plan'), value: t('planValue') },
  ];

  return (
    <>
      <Card>
        <CardContent className="gap-md flex flex-col">
          <div className="gap-2xs pt-2xs flex flex-col items-center text-center">
            <Avatar size="lg">
              <AvatarFallback>{orgInitials}</AvatarFallback>
            </Avatar>
            <span className="text-foreground pt-2xs text-sm font-semibold">{org.name}</span>
            <span className="text-muted-foreground text-2xs">{org.slug}</span>
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-2xs flex flex-col">
          <span className="text-foreground text-sm font-semibold">{t('tipTitle')}</span>
          <p className="text-muted-foreground text-2xs leading-relaxed">{t('tipBody')}</p>
        </CardContent>
      </Card>
    </>
  );
}
