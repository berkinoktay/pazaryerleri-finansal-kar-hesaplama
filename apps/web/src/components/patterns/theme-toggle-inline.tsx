'use client';

import { Moon02Icon, Sun03Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useIsMounted } from '@/lib/use-is-mounted';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme-provider';

/**
 * Inline theme toggle for the sidebar bottom dock.
 *
 * Built on `SidebarMenuButton` so the row inherits the same icon-only
 * collapse behavior + Radix Tooltip wiring as every other sidebar item.
 * The previous implementation used a custom div with a `<Switch>`, which
 * leaked label text and the switch handle into the 48px icon column when
 * the sidebar collapsed.
 *
 * SSR safety (apps/web/CLAUDE.md "SSR safety" #1):
 *   - `useTheme()` is NOT read during render to decide what to render.
 *   - Both Sun and Moon icons are always in the DOM, overlaid in a fixed
 *     box; the `dark:` Tailwind variant swaps their opacity. next-themes'
 *     head script writes `class="dark"` on `<html>` before hydration, so
 *     CSS applies from the first paint.
 *   - `aria-pressed` reads `resolvedTheme` only after mount (via
 *     `useIsMounted` gate); pre-mount it falls back to `false`. Hydration
 *     stays byte-identical because the visible icon swap is CSS-only.
 */
export function ThemeToggleInline(): React.ReactElement {
  const t = useTranslations('themeToggle');
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useIsMounted();

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          aria-pressed={isDark}
          aria-label={t('label')}
          tooltip={t('label')}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
        >
          <span
            aria-hidden
            className="size-icon-sm relative flex shrink-0 items-center justify-center"
          >
            <Sun03Icon
              data-testid="theme-icon-sun"
              className={cn(
                'size-icon-sm duration-base ease-out-quart absolute inset-0 scale-100 rotate-0 transition-transform',
                'dark:scale-0 dark:-rotate-90',
              )}
            />
            <Moon02Icon
              data-testid="theme-icon-moon"
              className={cn(
                'size-icon-sm duration-base ease-out-quart absolute inset-0 scale-0 rotate-90 transition-transform',
                'dark:scale-100 dark:rotate-0',
              )}
            />
          </span>
          <span>{t('label')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
