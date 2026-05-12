'use client';

import { Cancel01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CostProfileTypeIconSquare,
  ProfileAmount,
} from '@/features/costs/components/cost-profile-glyphs';
import { useAttachCostProfiles } from '@/features/costs/hooks/use-attach-cost-profiles';
import { useCostProfiles } from '@/features/costs/hooks/use-cost-profiles';
import { useDetachCostProfiles } from '@/features/costs/hooks/use-detach-cost-profiles';
import { useVariantCostProfiles } from '@/features/costs/hooks/use-variant-cost-profiles';
import type { CostProfile } from '@/features/costs/types/cost-profile.types';
import { CostProfileType } from '@/features/costs/types/cost-profile.types';
import { cn } from '@/lib/utils';

import type { VariantSummary } from '../api/list-products.api';

import { CostCellCreateBridge } from './cost-cell-create-bridge';

export interface CostCellPopoverProps {
  orgId: string;
  variant: VariantSummary;
  children: React.ReactNode;
}

/**
 * Popover anchored to the cost cell in the products table.
 *
 * Composition (top → bottom):
 *   Title row (name + attached count)
 *   Attached profile list (or inline empty message)
 *   Flat search input — no nested popup, no extra border
 *   Search results / "no match" message
 *   Footer: "+ Yeni profil oluştur"
 *
 * The search uses `Command` (cmdk) inline so the input and option list
 * live in the same layer as the panel. Borders between sections come
 * from the panel's own divider rule, not from the CommandInput's wrapper
 * (which is stripped to avoid the "input floating inside panel" look).
 */
export function CostCellPopover({
  orgId,
  variant,
  children,
}: CostCellPopoverProps): React.ReactElement {
  const t = useTranslations('products.costCell.popover');
  const [open, setOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const attachedQuery = useVariantCostProfiles(open ? { orgId, variantId: variant.id } : null);
  const allProfilesQuery = useCostProfiles(open ? { orgId, filters: { archived: 'false' } } : null);

  const attachMutation = useAttachCostProfiles();
  const detachMutation = useDetachCostProfiles();

  const attachedProfiles = attachedQuery.data?.data ?? [];
  const attachedIds = React.useMemo(
    () => new Set(attachedProfiles.map((p) => p.id)),
    [attachedProfiles],
  );

  const availableProfiles = React.useMemo(() => {
    const all = allProfilesQuery.data?.data ?? [];
    return all.filter((p) => !attachedIds.has(p.id));
  }, [allProfilesQuery.data, attachedIds]);

  function handleAttach(profileId: string) {
    const profile = allProfilesQuery.data?.data.find((p) => p.id === profileId);
    attachMutation.mutate({
      orgId,
      profileIds: [profileId],
      variantIds: [variant.id],
      ...(profile !== undefined ? { optimisticProfiles: [profile] } : {}),
    });
  }

  function handleDetach(profile: CostProfile) {
    detachMutation.mutate({
      orgId,
      profileIds: [profile.id],
      variantIds: [variant.id],
    });
  }

  const isInitialLoading = attachedQuery.isLoading;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-dropdown-popover p-0">
          {/* Title row */}
          <div className="px-md pt-sm pb-2xs flex items-baseline justify-between">
            <h3 className="text-foreground text-sm font-semibold">{t('title')}</h3>
            {attachedProfiles.length > 0 ? (
              <span className="text-muted-foreground text-2xs tabular-nums">
                {t('attachedCount', { count: attachedProfiles.length })}
              </span>
            ) : null}
          </div>

          {/* Attached profiles list / loading / empty */}
          {isInitialLoading ? (
            <div className="px-sm pb-sm gap-3xs flex flex-col">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-4/5" />
            </div>
          ) : attachedProfiles.length === 0 ? (
            <p className="px-md pb-sm text-muted-foreground text-xs">{t('emptyAttached')}</p>
          ) : (
            <ul className="px-xs pb-xs gap-3xs flex flex-col">
              {attachedProfiles.map((profile) => (
                <AttachedProfileRow
                  key={profile.id}
                  profile={profile}
                  onRemove={() => handleDetach(profile)}
                  removeLabel={t('removeLabel', { name: profile.name })}
                  isPending={
                    detachMutation.isPending &&
                    detachMutation.variables?.profileIds.includes(profile.id)
                  }
                />
              ))}
            </ul>
          )}

          {/* Inline cmdk — flat input integrates with the panel via wrapperClassName override */}
          <Command className="border-border border-t">
            <CommandInput
              placeholder={t('searchPlaceholder')}
              className="text-sm"
              wrapperClassName="border-0 shadow-none rounded-none m-0 border-b border-border h-9 px-md"
            />
            <CommandList className="max-h-48">
              <CommandEmpty className="text-muted-foreground px-md py-sm text-xs">
                {t('noResults')}
              </CommandEmpty>
              {availableProfiles.length > 0 ? (
                <CommandGroup className="p-xs">
                  {availableProfiles.map((profile) => (
                    <CommandItem
                      key={profile.id}
                      value={`${profile.name} ${profile.currency} ${profile.amount}`}
                      onSelect={() => handleAttach(profile.id)}
                      className="gap-sm flex items-center"
                      disabled={attachMutation.isPending}
                    >
                      <CostProfileTypeIconSquare type={profile.type as CostProfileType} />
                      <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                        {profile.name}
                      </span>
                      <ProfileAmount
                        amount={profile.amount}
                        currency={profile.currency}
                        className="text-muted-foreground shrink-0 text-xs"
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>

          {/* Footer: create new */}
          <div className="border-border p-xs border-t">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
              className="text-primary hover:bg-primary/5 duration-fast gap-xs flex w-full items-center rounded-sm px-2 py-1.5 text-xs font-medium transition-colors"
            >
              <PlusSignIcon className="size-icon-xs" />
              {t('newProfile')}
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <CostCellCreateBridge
        orgId={orgId}
        variantId={variant.id}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </>
  );
}

// ─── Attached row ────────────────────────────────────────────────────────────

interface AttachedProfileRowProps {
  profile: CostProfile;
  onRemove: () => void;
  removeLabel: string;
  isPending?: boolean;
}

/**
 * Dense attached-profile row. The remove button stays visible at low
 * opacity so the affordance is discoverable; full opacity on hover.
 * Amount snaps to the visible content edge via `ml-auto` rather than
 * stretching across the full panel width with `flex-1`.
 */
function AttachedProfileRow({
  profile,
  onRemove,
  removeLabel,
  isPending = false,
}: AttachedProfileRowProps): React.ReactElement {
  return (
    <li className="gap-sm group hover:bg-muted/60 duration-fast flex items-center rounded-sm px-2 py-1.5 transition-colors">
      <CostProfileTypeIconSquare type={profile.type as CostProfileType} />
      <span className="text-foreground min-w-0 flex-1 truncate text-sm">{profile.name}</span>
      <ProfileAmount
        amount={profile.amount}
        currency={profile.currency}
        className="text-foreground shrink-0 text-xs"
      />
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        disabled={isPending}
        className={cn(
          'text-muted-foreground/50 hover:text-destructive hover:bg-destructive-surface',
          'duration-fast flex size-6 shrink-0 items-center justify-center rounded-sm',
          'group-hover:text-muted-foreground transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          '[&_svg]:size-icon-xs',
        )}
      >
        <Cancel01Icon />
      </button>
    </li>
  );
}
