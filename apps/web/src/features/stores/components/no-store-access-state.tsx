'use client';

import { StoreLocation01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/patterns/empty-state';

/**
 * Panel-access gate state for a MEMBER/VIEWER who holds no store grants. They
 * cannot connect a store themselves, so there is no CTA — the copy directs them
 * to ask an organization admin. The sidebar org switcher stays visible, so they
 * can switch to an org where they do have access.
 */
export function NoStoreAccessState(): ReactElement {
  const t = useTranslations('dashboard.noStoreAccess');
  return (
    <div className="p-2xl flex h-full items-center justify-center">
      <EmptyState
        icon={StoreLocation01Icon}
        title={t('title')}
        description={t('description')}
        className="max-w-form"
      />
    </div>
  );
}
