'use client';

import { Tick01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { MarketplaceLogo } from '@/components/patterns/marketplace-logo';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Link } from '@/i18n/navigation';
import { getOrgAvatarPalette, type OrgAvatarPalette } from '@/lib/org-avatar-color';
import { cn } from '@/lib/utils';

import type { Organization, OrgRole, Store, SyncState } from './org-store-switcher';

interface OrgStoreSwitcherListProps {
  orgs: Organization[];
  stores: Store[];
  activeOrgId: string | null;
  activeStoreId: string | null;
  onSelectOrg: (orgId: string) => void;
  onSelectStore: (storeId: string) => void;
}

/**
 * Solid background utility per palette name — same record as the trigger
 * uses, but inlined here to keep the list self-contained (no cross-file
 * import for a 6-key dictionary).
 */
const PALETTE_BG: Record<OrgAvatarPalette, string> = {
  primary: 'bg-primary text-primary-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  accent: 'bg-accent text-accent-foreground',
};

const SYNC_BG: Record<SyncState, string> = {
  fresh: 'bg-success',
  stale: 'bg-warning',
  failed: 'bg-destructive',
};

const ROLE_KEY: Record<OrgRole, 'roleOwner' | 'roleAdmin' | 'roleMember'> = {
  OWNER: 'roleOwner',
  ADMIN: 'roleAdmin',
  MEMBER: 'roleMember',
};

const ROLE_TONE: Record<OrgRole, NonNullable<BadgeProps['tone']>> = {
  OWNER: 'primary',
  ADMIN: 'neutral',
  MEMBER: 'outline',
};

/**
 * Inner list rendered inside the switcher's popover panel.  Two cmdk
 * groups — Organizations + Stores — separated by a thin divider.  Each
 * row exposes a `value` that combines the display name and id so the
 * cmdk fuzzy filter has both signals to match user input.  Footer with
 * org-settings / store-management / +new-org links sits below.
 */
export function OrgStoreSwitcherList({
  orgs,
  stores,
  activeOrgId,
  activeStoreId,
  onSelectOrg,
  onSelectStore,
}: OrgStoreSwitcherListProps): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');

  return (
    <div className="flex flex-col">
      <Command>
        <CommandInput placeholder={t('search')} />
        <CommandList>
          <CommandEmpty>{t('emptyDescription')}</CommandEmpty>
          <CommandGroup heading={t('sectionOrgs')}>
            {orgs.map((org) => {
              const palette = getOrgAvatarPalette(org.id);
              const isActive = org.id === activeOrgId;
              return (
                <CommandItem
                  key={org.id}
                  value={`${org.name} ${org.id}`}
                  onSelect={() => onSelectOrg(org.id)}
                  className={cn(isActive && 'bg-accent')}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-md text-2xs flex shrink-0 items-center justify-center rounded-sm font-semibold',
                      PALETTE_BG[palette],
                    )}
                  >
                    {org.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-foreground min-w-0 flex-1 truncate text-xs">
                    {org.name}
                  </span>
                  <Badge tone={ROLE_TONE[org.role]} size="sm">
                    {t(ROLE_KEY[org.role])}
                  </Badge>
                  {isActive ? (
                    <Tick01Icon
                      className="size-icon-xs text-muted-foreground shrink-0"
                      aria-hidden
                    />
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
          {stores.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={t('sectionStores')}>
                {stores.map((store) => {
                  const isActive = store.id === activeStoreId;
                  return (
                    <CommandItem
                      key={store.id}
                      value={`${store.name} ${store.id}`}
                      onSelect={() => onSelectStore(store.id)}
                      className={cn(isActive && 'bg-accent')}
                    >
                      <span className="shrink-0">
                        <MarketplaceLogo platform={store.platform} size="sm" alt="" />
                      </span>
                      <span className="text-foreground min-w-0 flex-1 truncate text-xs">
                        {store.name}
                      </span>
                      <span
                        aria-hidden
                        className={cn('size-2xs shrink-0 rounded-full', SYNC_BG[store.syncState])}
                      />
                      {isActive ? (
                        <Tick01Icon
                          className="size-icon-xs text-muted-foreground shrink-0"
                          aria-hidden
                        />
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
      <div className="border-border gap-3xs p-xs flex flex-col border-t">
        <Link
          href="/settings/organization"
          className="text-muted-foreground hover:text-foreground hover:bg-muted px-xs py-3xs text-2xs rounded-sm"
        >
          {t('footerOrgSettings')}
        </Link>
        <Link
          href="/settings/stores"
          className="text-muted-foreground hover:text-foreground hover:bg-muted px-xs py-3xs text-2xs rounded-sm"
        >
          {t('footerStoreManagement')}
        </Link>
        <Link
          href="/onboarding/create-organization"
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-xs py-3xs text-2xs rounded-sm text-center font-medium"
        >
          {t('footerNewOrg')}
        </Link>
      </div>
    </div>
  );
}

/**
 * Replaces the list when no orgs exist for the current user.  Two CTAs:
 * primary (create new) and secondary (join via invite).  Both are
 * locale-aware Next links — the routes may not exist yet at build time
 * for every flavor of installation; if so the future feature task
 * connects them.  A 404 here is a known stub during the rollout.
 */
export function OrgStoreSwitcherEmpty(): React.ReactElement {
  const t = useTranslations('orgStoreSwitcher');
  return (
    <div className="gap-sm p-md flex flex-col">
      <h3 className="text-foreground text-sm font-semibold">{t('emptyTitle')}</h3>
      <p className="text-muted-foreground text-2xs">{t('emptyDescription')}</p>
      <div className="gap-2xs flex flex-col">
        <Link
          href="/onboarding/create-organization"
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-sm py-xs text-2xs rounded-sm text-center font-medium"
        >
          {t('emptyCreate')}
        </Link>
        <Link
          href="/onboarding/join-organization"
          className="bg-muted text-foreground hover:bg-accent px-sm py-xs text-2xs rounded-sm text-center"
        >
          {t('emptyJoinInvite')}
        </Link>
      </div>
    </div>
  );
}
