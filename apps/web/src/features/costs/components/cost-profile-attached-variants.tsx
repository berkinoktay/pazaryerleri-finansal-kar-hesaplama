'use client';

import { LinkSquare02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/patterns/empty-state';
import { TimeAgo } from '@/components/patterns/time-ago';

import type { AttachedVariant } from '../types/cost-profile.types';
import { useDetachCostProfiles } from '../hooks/use-detach-cost-profiles';

// ─── Skeleton ────────────────────────────────────────────────────────────────

function AttachedVariantsSkeleton(): React.ReactElement {
  return (
    <div className="gap-sm flex flex-col" role="status" aria-label="Yükleniyor">
      {[0, 1, 2].map((i) => (
        <div key={i} className="gap-sm flex items-center justify-between rounded-lg border p-4">
          <div className="gap-xs flex flex-col">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CostProfileAttachedVariantsProps {
  orgId: string;
  profileId: string;
  variants: AttachedVariant[];
  isLoading: boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * List of product variants attached to a cost profile.
 *
 * Shows product title, stock code, and attach timestamp per row.
 * Each row has a "Ayır" detach button that fires `useDetachCostProfiles`.
 *
 * @useWhen displaying attached product variants in the "Bağlı varyantlar" tab
 */
export function CostProfileAttachedVariants({
  orgId,
  profileId,
  variants,
  isLoading,
}: CostProfileAttachedVariantsProps): React.ReactElement {
  const t = useTranslations('costs.detail.attachedVariants');
  const detach = useDetachCostProfiles();

  if (isLoading) {
    return <AttachedVariantsSkeleton />;
  }

  if (variants.length === 0) {
    return (
      <EmptyState
        icon={LinkSquare02Icon}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  function handleDetach(variant: AttachedVariant) {
    detach.mutate({
      orgId,
      profileIds: [profileId],
      variantIds: [variant.productVariantId],
    });
  }

  return (
    <div className="gap-sm flex flex-col">
      {variants.map((variant) => (
        <div
          key={variant.linkId}
          className="border-border gap-sm flex items-center justify-between rounded-lg border p-4"
        >
          <div className="gap-xs flex min-w-0 flex-col">
            <span className="text-foreground truncate text-sm font-medium">
              {variant.productTitle}
            </span>
            <div className="gap-sm text-muted-foreground flex items-center text-xs">
              <span>{variant.stockCode}</span>
              <span>·</span>
              <TimeAgo value={variant.attachedAt} />
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            aria-label={t('detachLabel', { stockCode: variant.stockCode })}
            disabled={detach.isPending}
            onClick={() => handleDetach(variant)}
          >
            {t('detach')}
          </Button>
        </div>
      ))}
    </div>
  );
}
