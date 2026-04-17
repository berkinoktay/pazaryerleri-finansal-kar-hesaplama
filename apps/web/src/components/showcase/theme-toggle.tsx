'use client';

import { Moon02Icon, Sun03Icon, ComputerIcon } from 'hugeicons-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/providers/theme-provider';

export function ThemeToggle(): React.ReactElement {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Tema seç">
          {theme === 'dark' ? (
            <Moon02Icon className="size-icon-sm" />
          ) : theme === 'system' ? (
            <ComputerIcon className="size-icon-sm" />
          ) : (
            <Sun03Icon className="size-icon-sm" />
          )}
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
