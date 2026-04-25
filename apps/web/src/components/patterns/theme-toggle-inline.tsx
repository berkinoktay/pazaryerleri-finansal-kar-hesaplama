'use client';

import { Moon02Icon, Sun03Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Switch } from '@/components/ui/switch';
import { useIsMounted } from '@/lib/use-is-mounted';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme-provider';

/**
 * Inline theme toggle for the sidebar bottom dock.
 *
 * SSR safety (apps/web/CLAUDE.md "SSR safety" #1):
 *   - useTheme() is NOT read during render to decide what to render.
 *   - Both Sun and Moon icons are always in the DOM; the `dark:`
 *     Tailwind variant swaps which is visible.  next-themes' head
 *     script puts class="dark" on <html> before hydration so CSS
 *     applies from the first paint.
 *   - The Switch's `checked` prop reads `resolvedTheme` only after
 *     mount (via useIsMounted gate) — until then it falls back to
 *     the SSR-rendered "off" state.  Hydration stays byte-identical.
 */
export function ThemeToggleInline(): React.ReactElement {
  const t = useTranslations('themeToggle');
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useIsMounted();

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <div className="bg-muted gap-xs px-xs py-3xs text-2xs flex items-center rounded-sm">
      <Sun03Icon
        data-testid="theme-icon-sun"
        className={cn('size-icon-sm shrink-0 transition-opacity dark:opacity-40')}
        aria-hidden
      />
      <Moon02Icon
        data-testid="theme-icon-moon"
        className={cn('size-icon-sm shrink-0 opacity-40 transition-opacity dark:opacity-100')}
        aria-hidden
      />
      <span className="flex-1">{t('label')}</span>
      <Switch
        checked={isDark}
        onCheckedChange={(next) => setTheme(next ? 'dark' : 'light')}
        aria-label={t('label')}
      />
    </div>
  );
}
