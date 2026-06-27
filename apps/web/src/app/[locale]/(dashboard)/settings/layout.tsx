import * as React from 'react';

import { SettingsNav } from './settings-nav';

/**
 * Settings shell — a scope-grouped secondary nav (Hesabım / Organizasyon /
 * Mağaza) beside a 1fr content column. Sits inside the dashboard shell, so
 * sub-page navigation happens here without disturbing the primary sidebar.
 * The nav itself (a client island) owns the active state, the mobile
 * collapse, the store picker, and the developer-only draft markers.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="gap-md flex flex-col md:flex-row">
      <SettingsNav />
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
