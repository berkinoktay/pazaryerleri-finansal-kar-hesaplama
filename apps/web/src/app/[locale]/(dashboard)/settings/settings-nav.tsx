'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FeatureStatusMarker } from '@/components/patterns/feature-status-marker';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { SETTINGS_NAV_SECTIONS } from './settings-nav-config';

/**
 * Settings secondary navigation, grouped by ownership scope (Hesabım /
 * Organizasyon / Mağaza). Desktop renders a sticky left sidebar; mobile
 * collapses it into one grouped <Select> so the page list never crowds a
 * phone. Draft pages carry a developer-only marker (dev/test only). Pure
 * config — store-scoped pages read the active store from the dashboard rail,
 * so settings carries no store picker.
 */
export function SettingsNav(): React.ReactElement {
  const t = useTranslations();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <>
      {/* Mobile: one grouped select. */}
      <nav aria-label={t('settings.nav.ariaLabel')} className="w-full md:hidden">
        <Select value={pathname} onValueChange={(href) => router.push(href)}>
          <SelectTrigger aria-label={t('settings.nav.mobileNavLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SETTINGS_NAV_SECTIONS.map((section) => (
              <SelectGroup key={section.key}>
                <SelectLabel>{t(section.labelKey)}</SelectLabel>
                {section.items.map((item) => (
                  <SelectItem key={item.key} value={item.href} leadingIcon={<item.icon />}>
                    {t(item.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </nav>

      {/* Desktop: sticky grouped sidebar. */}
      <aside
        aria-label={t('settings.nav.ariaLabel')}
        className="border-border bg-card p-sm gap-lg md:w-settings-aside md:top-xl hidden h-fit w-full flex-col rounded-lg border shadow-xs md:sticky md:flex md:shrink-0"
      >
        {SETTINGS_NAV_SECTIONS.map((section) => (
          <div key={section.key} className="gap-2xs flex flex-col">
            <span className="text-muted-foreground text-2xs px-sm pb-2xs font-medium tracking-wide uppercase">
              {t(section.labelKey)}
            </span>
            {section.items.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group gap-sm px-sm py-xs duration-fast flex items-center rounded-md text-sm transition-colors',
                    'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                    isActive
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-icon-sm shrink-0 transition-colors',
                      isActive ? 'text-accent-foreground' : 'text-muted-foreground-dim',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                  <FeatureStatusMarker status={item.status} variant="dot" />
                </Link>
              );
            })}
          </div>
        ))}
      </aside>
    </>
  );
}
