'use client';

import { Menu01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';
import { UserMenu } from '@/features/auth/components/user-menu';
import { Link } from '@/i18n/navigation';

export interface MobileTopBarProps {
  onOpenNav: () => void;
  /** Optional trailing slot — typically <NotificationBell /> */
  trailing?: React.ReactNode;
}

/**
 * Visible only below `md`. Hosts the hamburger trigger (opens
 * MobileNavSheet — Task 25), brand logo, optional trailing action
 * (notification bell), and the user menu.
 */
export function MobileTopBar({ onOpenNav, trailing }: MobileTopBarProps): React.ReactElement {
  const t = useTranslations('mobileTopBar');
  return (
    <header className="border-border bg-background gap-xs px-sm py-xs flex h-12 items-center justify-between border-b md:hidden">
      <div className="gap-xs flex items-center">
        <Button variant="ghost" size="icon-sm" onClick={onOpenNav} aria-label={t('openNav')}>
          <Menu01Icon className="size-icon-sm" />
        </Button>
        <Link href="/dashboard" aria-label={t('home')}>
          <Wordmark withText={false} />
        </Link>
      </div>
      <div className="gap-xs flex items-center">
        {trailing}
        <UserMenu />
      </div>
    </header>
  );
}
