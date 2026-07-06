import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';

import { SettingsDetail } from './settings-detail';
import { SettingsNav } from './settings-nav';

/**
 * Settings page skeleton. The page title spans the full width at the very top —
 * its left edge aligned with the secondary nav below it — and the scope-grouped
 * nav sits beside the content in the row underneath. This is what makes the
 * heading line up with the nav (instead of floating inside the content column),
 * and it keeps every settings page structurally identical.
 *
 * Pass `aside` for the 2/3 + 1/3 detail layout; omit it for full-width pages
 * (Üyeler, Bağlantılar) that render a table directly.
 */
export function SettingsPageShell({
  title,
  intent,
  actions,
  aside,
  children,
}: {
  title: string;
  intent?: string;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="gap-lg flex flex-col">
      <PageHeader variant="framed" title={title} intent={intent} actions={actions} />
      <div className="gap-lg flex flex-col md:flex-row">
        <SettingsNav />
        <section className="min-w-0 flex-1">
          <SettingsDetail aside={aside}>{children}</SettingsDetail>
        </section>
      </div>
    </div>
  );
}
