'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';

/**
 * Contextual aside for the Güvenlik page — a compact security status summary
 * (2FA state, last password change, active session count) plus a security tip.
 * Display-only: no actions, no mutations. Values are representative placeholders
 * until the backend security-status endpoint is wired.
 */
export function SecuritySummaryCard(): React.ReactElement {
  const t = useTranslations('settings.security.summary');

  const rows = [
    { key: 'twoFactor', label: t('twoFactor'), value: t('twoFactorValue') },
    {
      key: 'lastPasswordChange',
      label: t('lastPasswordChange'),
      value: t('lastPasswordChangeValue'),
    },
    { key: 'activeSessions', label: t('activeSessions'), value: t('activeSessionsValue') },
  ];

  return (
    <>
      <Card>
        <CardContent className="gap-md flex flex-col">
          <span className="text-foreground pt-2xs text-sm font-semibold">{t('title')}</span>
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
