'use client';

import { Cancel01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Combobox, type ComboboxOption } from '@/components/patterns/combobox';
import { Currency } from '@/components/patterns/currency';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { CostProfileTypeBadge } from '@/features/costs/components/cost-profile-type-badge';
import { useAttachCostProfiles } from '@/features/costs/hooks/use-attach-cost-profiles';
import { useCostProfiles } from '@/features/costs/hooks/use-cost-profiles';
import { useDetachCostProfiles } from '@/features/costs/hooks/use-detach-cost-profiles';
import { useVariantCostProfiles } from '@/features/costs/hooks/use-variant-cost-profiles';
import type { CostProfile } from '@/features/costs/types/cost-profile.types';
import { CostProfileType } from '@/features/costs/types/cost-profile.types';

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
 * Sections:
 *   1. Attached profiles list — type icon + name + TRY amount + remove button
 *   2. Combobox to pick and attach an existing non-archived profile
 *   3. Footer link to create a new profile (opens CostProfileCreateDialog)
 *
 * Mutations invalidate `costsKeys.variantAttachments(variantId)` on success
 * so the attached list refreshes on the next open. Full optimistic UI (PR 10).
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

  const comboboxOptions: ComboboxOption[] = React.useMemo(() => {
    const all = allProfilesQuery.data?.data ?? [];
    return all
      .filter((p) => !attachedIds.has(p.id))
      .map((p) => ({
        value: p.id,
        label: p.name,
        description: `${p.currency} ${p.amount}`,
        icon: <CostProfileTypeBadge type={p.type as CostProfileType} iconOnly />,
      }));
  }, [allProfilesQuery.data, attachedIds]);

  function handleAttach(profileId: string | null) {
    if (profileId === null) return;
    attachMutation.mutate({
      orgId,
      profileIds: [profileId],
      variantIds: [variant.id],
    });
  }

  function handleDetach(profile: CostProfile) {
    detachMutation.mutate({
      orgId,
      profileIds: [profile.id],
      variantIds: [variant.id],
    });
  }

  const isLoading = attachedQuery.isLoading || allProfilesQuery.isLoading;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0" sideOffset={6}>
          <div className="gap-md flex flex-col">
            {/* Header */}
            <div className="px-md pt-md">
              <p className="text-foreground text-sm font-medium">{t('title')}</p>
            </div>

            <Separator />

            {/* Attached profiles list */}
            <div className="px-md">
              {isLoading ? (
                <div className="gap-xs flex flex-col">
                  <Skeleton className="h-7 w-full" />
                  <Skeleton className="h-7 w-4/5" />
                </div>
              ) : attachedProfiles.length === 0 ? null : (
                <ul className="gap-xs flex flex-col">
                  {attachedProfiles.map((profile) => (
                    <AttachedProfileRow
                      key={profile.id}
                      profile={profile}
                      onRemove={() => handleDetach(profile)}
                      removeLabel={t('removeLabel')}
                      isPending={
                        detachMutation.isPending &&
                        detachMutation.variables?.profileIds.includes(profile.id)
                      }
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Combobox to attach an existing profile */}
            <div className="px-md">
              <Combobox
                value={null}
                onChange={handleAttach}
                options={comboboxOptions}
                placeholder={t('attachPlaceholder')}
                searchPlaceholder={t('attachSearch')}
                emptyMessage={t('attachEmpty')}
                loading={attachMutation.isPending || allProfilesQuery.isLoading}
                disabled={attachMutation.isPending}
                triggerSize="sm"
              />
            </div>

            <Separator />

            {/* Footer: create new profile */}
            <div className="px-md pb-md">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="text-primary hover:text-primary/80 duration-fast text-xs transition-colors"
              >
                {t('newProfile')}
              </button>
            </div>
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

// ─── Sub-components ───────────────────────────────────────────────────────────

interface AttachedProfileRowProps {
  profile: CostProfile;
  onRemove: () => void;
  removeLabel: string;
  isPending?: boolean;
}

function AttachedProfileRow({
  profile,
  onRemove,
  removeLabel,
  isPending = false,
}: AttachedProfileRowProps): React.ReactElement {
  return (
    <li className="gap-xs flex items-center">
      <CostProfileTypeBadge type={profile.type as CostProfileType} iconOnly />
      <span className="text-foreground min-w-0 flex-1 truncate text-sm">{profile.name}</span>
      <Currency value={profile.amount} className="text-muted-foreground shrink-0 text-xs" />
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        disabled={isPending}
        className="text-muted-foreground hover:text-destructive duration-fast [&_svg]:size-icon-xs ml-auto shrink-0 transition-colors disabled:opacity-50"
      >
        <Cancel01Icon />
      </button>
    </li>
  );
}
