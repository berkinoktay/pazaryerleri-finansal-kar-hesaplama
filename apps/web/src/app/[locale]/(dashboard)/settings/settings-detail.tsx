import * as React from 'react';

/**
 * Two-column settings detail layout: a main content column (the forms /
 * sections) plus a contextual `aside` (account summary, tips, related
 * status). On `lg` screens the main column takes 2/3 and the aside 1/3;
 * below `lg` the aside stacks under the main column. Form/section pages use
 * this; full-width table pages (Üyeler, Bağlantılar) render their content
 * directly without an aside (omit it and this collapses to a single column).
 */
export function SettingsDetail({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}): React.ReactElement {
  if (aside === undefined) {
    return <div className="gap-lg flex flex-col">{children}</div>;
  }
  return (
    <div className="gap-lg grid grid-cols-1 items-start lg:grid-cols-3">
      <div className="gap-lg flex min-w-0 flex-col lg:col-span-2">{children}</div>
      <aside className="gap-lg flex flex-col lg:col-span-1">{aside}</aside>
    </div>
  );
}
