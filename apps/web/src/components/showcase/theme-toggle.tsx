'use client';

import { ComputerIcon, Moon02Icon, Sun03Icon } from 'hugeicons-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/providers/theme-provider';

/**
 * Theme toggle — shadcn's canonical SSR-safe pattern.
 *
 * The trigger does NOT read `theme` during render; it renders BOTH the sun
 * and moon icons simultaneously and lets CSS (`dark:` variant) toggle their
 * visibility. `next-themes` injects a `<script>` into `<head>` that reads
 * localStorage and sets `class="dark"` on `<html>` BEFORE React hydrates,
 * so the correct icon is visible from the very first paint and the
 * server-rendered markup matches the client exactly — no hydration mismatch,
 * no mount-gate flash.
 *
 * The dropdown items still reference the resolved UI label (Light / Dark /
 * System) and carry their own icons; reading `theme` there is fine because
 * the menu is only rendered after a click (no SSR, no hydration concern).
 */
export function ThemeToggle(): React.ReactElement {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Tema seç">
          <Sun03Icon className="size-icon-sm duration-fast scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
          <Moon02Icon className="size-icon-sm duration-fast absolute scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun03Icon className="size-icon-sm" /> Açık
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon02Icon className="size-icon-sm" /> Koyu
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <ComputerIcon className="size-icon-sm" /> Sistem
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
