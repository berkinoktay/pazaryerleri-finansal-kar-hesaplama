'use client';

import { Logout01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';

import { useCurrentUser } from '@/features/auth/hooks/use-current-user';
import { useSignOut } from '@/features/auth/hooks/use-sign-out';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * User menu — avatar trigger with a dropdown showing the signed-in
 * user's email + a Sign Out button. Slotted into the icon rail bottom
 * slot (replacing the previous static avatar placeholder).
 */
export function UserMenu(): React.ReactElement {
  const t = useTranslations('auth.userMenu');
  const { data: user } = useCurrentUser();
  const signOut = useSignOut();

  const initials = deriveInitials(user?.email ?? '?');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-9 items-center justify-center rounded-md focus-visible:outline-none"
        aria-label={t('signOut')}
      >
        <Avatar className="size-7">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8}>
        {user?.email !== undefined ? (
          <>
            <DropdownMenuLabel className="text-muted-foreground truncate text-xs">
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          onSelect={() => {
            signOut.mutate();
          }}
          disabled={signOut.isPending}
        >
          <Logout01Icon className="size-icon-sm" />
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function deriveInitials(emailOrName: string): string {
  const base = emailOrName.split('@')[0] ?? '?';
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
