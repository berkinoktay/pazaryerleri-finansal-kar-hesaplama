'use client';

import { PlusSignIcon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
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
import { CostProfileType } from '@/features/costs/types/cost-profile.types';

import type { ProductWithVariants, VariantSummary } from '../api/list-products.api';

// ─── Aggregate helpers ─────────────────────────────────────────────────────

export interface CostAggregate {
  /** All variant cost values in TRY (null entries excluded). */
  min: number;
  max: number;
  /** Whether all variants share the same cost. */
  isSame: boolean;
  /** Common value when isSame is true. */
  sameValue: string | null;
  /** Count of variants that have ≥1 cost profile. */
  withProfiles: number;
  /** Count of variants with no cost profiles. */
  withoutProfiles: number;
}

export function computeCostAggregate(variants: VariantSummary[]): CostAggregate | null {
  let min = Infinity;
  let max = -Infinity;
  let withProfiles = 0;
  let firstCostTry: string | null = null;

  for (const v of variants) {
    if (v.profileCount > 0) {
      withProfiles++;
      if (v.currentCostTry !== null) {
        const cost = Number.parseFloat(v.currentCostTry);
        if (cost < min) min = cost;
        if (cost > max) max = cost;
        if (firstCostTry === null) firstCostTry = v.currentCostTry;
      }
    }
  }

  if (firstCostTry === null) return null;

  const isSame = min === max;
  return {
    min,
    max,
    isSame,
    sameValue: isSame ? firstCostTry : null,
    withProfiles,
    withoutProfiles: variants.length - withProfiles,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface ParentRowCostCellProps {
  orgId: string;
  product: ProductWithVariants;
}

/**
 * Cost cell for multi-variant parent rows in the products table.
 *
 * Trigger states (mirrors the variant-row CostCell rhythm):
 *   - No costs anywhere → "+ Maliyet ekle" pill
 *   - All same          → currency amount alone
 *   - Range             → "₺120 – ₺180" + small "8" chip (variant count)
 *
 * Popover content:
 *   Title row → sub-line ("X / N varyantta maliyet var")
 *   Flat search input (cmdk) — same flat treatment as CostCellPopover
 *   Result list → applies the chosen profile to ALL child variants
 *
 * Section header is intentionally dropped — the title + sub-line plus the
 * input placeholder convey intent without an additional uppercase label.
 */
export function ParentRowCostCell({ orgId, product }: ParentRowCostCellProps): React.ReactElement {
  const t = useTranslations('products.costCell');
  const tParent = useTranslations('products.parentCostCell');
  const tCommon = useTranslations('common');
  const formatter = useFormatter();
  const [open, setOpen] = React.useState(false);

  const allProfilesQuery = useCostProfiles(open ? { orgId, filters: { archived: 'false' } } : null);
  const attachMutation = useAttachCostProfiles();

  const allVariantIds = React.useMemo(() => product.variants.map((v) => v.id), [product.variants]);

  const aggregate = React.useMemo(() => computeCostAggregate(product.variants), [product.variants]);

  // Stats fall back to (with: 0, without: total) when no variant has profiles
  // yet, so the user always sees "X / N varyantta maliyet var".
  const stats =
    aggregate !== null
      ? {
          withCount: aggregate.withProfiles,
          totalCount: product.variants.length,
        }
      : { withCount: 0, totalCount: product.variants.length };

  function handleAttachToAll(profileId: string) {
    const profile = allProfilesQuery.data?.data.find((p) => p.id === profileId);
    attachMutation.mutate({
      orgId,
      profileIds: [profileId],
      variantIds: allVariantIds,
      ...(profile !== undefined ? { optimisticProfiles: [profile] } : {}),
    });
    setOpen(false);
  }

  const availableProfiles = allProfilesQuery.data?.data ?? [];

  function renderTrigger() {
    if (aggregate === null) {
      return (
        <button
          type="button"
          className="text-muted-foreground/70 hover:text-primary hover:bg-primary/5 duration-fast gap-2xs inline-flex h-7 cursor-pointer items-center rounded-sm px-2 text-xs transition-colors"
        >
          <PlusSignIcon className="size-icon-xs" />
          {t('addCost')}
        </button>
      );
    }

    const variantCountChip = !aggregate.isSame ? (
      <Badge
        tone="neutral"
        size="sm"
        radius="full"
        className="text-2xs px-1.5 font-medium tabular-nums"
      >
        {product.variants.length}
      </Badge>
    ) : null;

    const amount =
      aggregate.isSame && aggregate.sameValue !== null ? (
        <Currency value={aggregate.sameValue} className="text-sm tabular-nums" />
      ) : (
        <span className="text-foreground text-sm tabular-nums">
          {formatter.number(aggregate.min, 'currency')}
          {' – '}
          {formatter.number(aggregate.max, 'currency')}
        </span>
      );

    return (
      <button
        type="button"
        className="gap-xs hover:bg-muted/60 duration-fast inline-flex h-7 cursor-pointer items-center rounded-sm px-2 transition-colors"
      >
        {amount}
        {variantCountChip}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{renderTrigger()}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-dropdown-popover p-0">
        {/* Title bar with stats sub-line */}
        <div className="px-md pt-sm pb-2xs gap-3xs flex flex-col">
          <h3 className="text-foreground text-sm font-semibold">{tParent('popoverTitle')}</h3>
          <p className="text-muted-foreground text-xs">
            {tParent('coverage', { with: stats.withCount, total: stats.totalCount })}
          </p>
        </div>

        {/* Inline cmdk — same flat treatment as CostCellPopover */}
        <Command className="border-border border-t">
          <CommandInput
            placeholder={tParent('applyToAllSearch')}
            className="text-sm"
            wrapperClassName="border-0 shadow-none rounded-none m-0 border-b border-border h-9 px-md"
          />
          <CommandList className="max-h-56">
            {allProfilesQuery.isLoading ? (
              // Loading is NOT an empty catalog: skeleton option rows keep
              // CommandEmpty ("no results") for genuinely empty responses.
              <div
                role="status"
                aria-busy
                aria-label={tCommon('loading')}
                className="p-xs gap-3xs flex flex-col"
              >
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-4/5" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <CommandEmpty className="text-muted-foreground px-md py-sm text-xs">
                {tParent('applyToAllEmpty')}
              </CommandEmpty>
            )}
            {availableProfiles.length > 0 ? (
              <CommandGroup className="p-xs">
                {availableProfiles.map((profile) => (
                  <CommandItem
                    key={profile.id}
                    value={`${profile.name} ${profile.currency} ${profile.amountGross}`}
                    onSelect={() => handleAttachToAll(profile.id)}
                    className="gap-sm flex items-center"
                    disabled={attachMutation.isPending}
                  >
                    <CostProfileTypeIconSquare type={profile.type as CostProfileType} />
                    <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                      {profile.name}
                    </span>
                    <ProfileAmount
                      amount={profile.amountGross}
                      currency={profile.currency}
                      className="text-muted-foreground shrink-0 text-xs"
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
