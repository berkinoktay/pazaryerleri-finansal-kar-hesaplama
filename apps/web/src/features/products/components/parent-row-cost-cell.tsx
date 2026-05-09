'use client';

import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Combobox, type ComboboxOption } from '@/components/patterns/combobox';
import { Currency } from '@/components/patterns/currency';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { CostProfileTypeBadge } from '@/features/costs/components/cost-profile-type-badge';
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
 * Displays an aggregate cost label:
 *   - All variants same → "₺142,50 (tümü aynı)"
 *   - Range              → "₺120 – ₺180 / 8 varyant"
 *   - No costs at all   → "+ Maliyet ekle" placeholder
 *
 * Click opens a popover with:
 *   1. Summary stats (range + how many variants have/lack profiles)
 *   2. Combobox: "Bu ürünün tüm varyantlarına maliyet ekle"
 *      → calls useAttachCostProfiles with all child variant IDs
 */
export function ParentRowCostCell({ orgId, product }: ParentRowCostCellProps): React.ReactElement {
  const t = useTranslations('products.costCell');
  const tParent = useTranslations('products.parentCostCell');
  const formatter = useFormatter();
  const [open, setOpen] = React.useState(false);

  const allProfilesQuery = useCostProfiles(open ? { orgId, filters: { archived: 'false' } } : null);
  const attachMutation = useAttachCostProfiles();

  const allVariantIds = React.useMemo(() => product.variants.map((v) => v.id), [product.variants]);

  const aggregate = React.useMemo(() => computeCostAggregate(product.variants), [product.variants]);

  const comboboxOptions: ComboboxOption[] = React.useMemo(() => {
    const all = allProfilesQuery.data?.data ?? [];
    return all.map((p) => ({
      value: p.id,
      label: p.name,
      description: `${p.currency} ${p.amount}`,
      icon: <CostProfileTypeBadge type={p.type as CostProfileType} iconOnly />,
    }));
  }, [allProfilesQuery.data]);

  function handleAttachToAll(profileId: string | null) {
    if (profileId === null) return;
    attachMutation.mutate({
      orgId,
      profileIds: [profileId],
      variantIds: allVariantIds,
    });
  }

  function renderTrigger() {
    if (aggregate === null) {
      return (
        <button
          type="button"
          className="text-muted-foreground hover:text-primary duration-fast text-xs transition-colors"
        >
          {t('addCost')}
        </button>
      );
    }

    const badge =
      aggregate.isSame && aggregate.sameValue !== null ? (
        <Badge tone="neutral" size="sm" radius="full">
          {tParent('allSame')}
        </Badge>
      ) : (
        <Badge tone="neutral" size="sm" radius="full">
          {tParent('variantCount', { count: product.variants.length })}
        </Badge>
      );

    const amount =
      aggregate.isSame && aggregate.sameValue !== null ? (
        <Currency value={aggregate.sameValue} />
      ) : (
        <span className="text-foreground text-xs tabular-nums">
          {formatter.number(aggregate.min, 'currency')}
          {' – '}
          {formatter.number(aggregate.max, 'currency')}
        </span>
      );

    return (
      <button
        type="button"
        className="gap-xs hover:bg-muted duration-fast inline-flex cursor-pointer items-center rounded px-1 py-0.5 transition-colors"
      >
        {amount}
        {badge}
      </button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{renderTrigger()}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" sideOffset={6}>
        <div className="gap-md flex flex-col">
          {/* Header */}
          <div className="px-md pt-md">
            <p className="text-foreground text-sm font-medium">{tParent('popoverTitle')}</p>
            {aggregate !== null ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {tParent('popoverStats', {
                  with: aggregate.withProfiles,
                  without: aggregate.withoutProfiles,
                  total: product.variants.length,
                })}
              </p>
            ) : null}
          </div>

          <Separator />

          {/* Apply-to-all combobox */}
          <div className="px-md pb-md">
            <p className="text-muted-foreground mb-sm text-xs">{tParent('applyToAllLabel')}</p>
            <Combobox
              value={null}
              onChange={handleAttachToAll}
              options={comboboxOptions}
              placeholder={tParent('applyToAllPlaceholder')}
              searchPlaceholder={tParent('applyToAllSearch')}
              emptyMessage={tParent('applyToAllEmpty')}
              loading={attachMutation.isPending || allProfilesQuery.isLoading}
              disabled={attachMutation.isPending}
              triggerSize="sm"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
