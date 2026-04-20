import { Building03Icon } from 'hugeicons-react';
import { getTranslations } from 'next-intl/server';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import type { Organization } from '../api/organizations.api';

export interface ActiveOrganizationPanelProps {
  org: Organization;
  /**
   * Locale for Intl.DateTimeFormat. Passed explicitly so the same
   * server-rendered card looks right regardless of the viewer's
   * per-request locale — no Intl default guessing.
   */
  locale: string;
  /**
   * Viewer's display timezone (from GET /v1/me). Distinct from the
   * org's business-ops timezone: we format the org's `createdAt`
   * timestamp so the viewer sees it in their own clock, even though
   * reporting boundaries (elsewhere in the shell) use `org.timezone`.
   */
  viewerTimezone?: string;
}

/**
 * Compact card that echoes the currently-selected organization back
 * to the user. Re-renders on every cookie-driven switch, so it's the
 * proof-of-life that the switcher is actually doing something.
 *
 * Rendered server-side (no 'use client') — the shape doesn't need
 * interactivity and keeping it RSC means it stays byte-cheap on the
 * client.
 */
export async function ActiveOrganizationPanel({
  org,
  locale,
  viewerTimezone,
}: ActiveOrganizationPanelProps): Promise<React.ReactElement> {
  const t = await getTranslations('organizations.active');

  const formattedCreatedAt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: viewerTimezone ?? org.timezone,
  }).format(new Date(org.createdAt));

  return (
    <Card>
      <CardHeader className="gap-xs">
        <div className="gap-sm flex items-center">
          <div className="size-icon-lg bg-muted text-muted-foreground grid place-items-center rounded-md">
            <Building03Icon className="size-icon-sm" />
          </div>
          <div className="gap-3xs flex min-w-0 flex-col">
            <CardTitle className="text-foreground truncate">{org.name}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="gap-md grid grid-cols-2 sm:grid-cols-4">
          <Field label={t('slugLabel')} value={org.slug} mono />
          <Field label={t('currencyLabel')} value={org.currency} />
          <Field label={t('timezoneLabel')} value={org.timezone} />
          <Field label={t('createdLabel')} value={formattedCreatedAt} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="gap-3xs flex flex-col">
      <dt className="text-2xs text-muted-foreground font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className={`text-foreground truncate text-sm ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
