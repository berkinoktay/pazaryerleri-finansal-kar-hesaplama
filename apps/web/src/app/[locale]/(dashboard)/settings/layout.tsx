'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { SETTINGS_NAV_SECTIONS } from './settings-nav-config';

/**
 * Settings shell — internal 200px secondary sidebar (sections grouped:
 * Account / Connections) + 1fr content. Sits inside the main dashboard
 * shell; navigation between settings sub-pages happens here without
 * disturbing the primary sidebar.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();

  return (
    <div className="gap-md flex flex-col md:flex-row">
      <aside
        aria-label={t('settings.nav.ariaLabel')}
        className="border-border bg-card gap-md p-md md:w-settings-aside flex w-full flex-col rounded-md border md:shrink-0"
      >
        {SETTINGS_NAV_SECTIONS.map((section) => (
          <div key={section.key} className="gap-3xs flex flex-col">
            <span className="text-muted-foreground text-2xs tracking-wide uppercase">
              {t(section.labelKey)}
            </span>
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={cn(
                    'duration-fast px-xs py-3xs rounded-sm text-xs transition-colors',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </div>
        ))}
      </aside>
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
