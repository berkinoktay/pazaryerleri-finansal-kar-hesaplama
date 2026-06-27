import * as React from 'react';

/**
 * Settings shell. Each page composes its own skeleton via `SettingsPageShell`
 * (page title spanning the top, with the scope-grouped nav + content aligned in
 * the row below). This layout is a thin pass-through so that title row can span
 * the full width — the nav lives inside the shell, not beside the whole page.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
