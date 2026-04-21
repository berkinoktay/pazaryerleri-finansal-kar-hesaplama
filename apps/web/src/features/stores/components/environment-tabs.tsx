'use client';

import { useTranslations } from 'next-intl';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type StoreEnvironment = 'PRODUCTION' | 'SANDBOX';

export interface EnvironmentTabsProps {
  value: StoreEnvironment;
  onChange: (value: StoreEnvironment) => void;
}

/**
 * Whether the Sandbox tab is offered in this build. Mirrors the
 * backend ALLOW_SANDBOX_CONNECTIONS env var — cosmetic only; the
 * backend is the real gate.
 */
function isSandboxAllowed(): boolean {
  return process.env['NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS'] === 'true';
}

export function EnvironmentTabs({
  value,
  onChange,
}: EnvironmentTabsProps): React.ReactElement | null {
  const t = useTranslations('stores.connect');

  if (!isSandboxAllowed()) {
    // In production, there is only one environment — no tab UI needed.
    return null;
  }

  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as StoreEnvironment)}>
      <TabsList>
        <TabsTrigger value="PRODUCTION">{t('environmentOptions.PRODUCTION')}</TabsTrigger>
        <TabsTrigger value="SANDBOX">{t('environmentOptions.SANDBOX')}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
