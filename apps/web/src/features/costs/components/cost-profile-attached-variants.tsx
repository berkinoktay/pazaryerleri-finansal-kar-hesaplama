'use client';

import { ArrowRight02Icon, LinkSquare02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { ImageCell } from '@/components/patterns/image-cell';
import { TimeAgo } from '@/components/patterns/time-ago';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';

import type { AttachedVariant } from '../types/cost-profile.types';
import { useDetachCostProfiles } from '../hooks/use-detach-cost-profiles';

// ─── Skeleton ────────────────────────────────────────────────────────────────

function AttachedVariantsSkeleton(): React.ReactElement {
  return (
    <div className="gap-xs flex flex-col" role="status" aria-label="Yükleniyor">
      {[0, 1, 2].map((i) => (
        <div key={i} className="gap-sm flex items-center py-3">
          <Skeleton className="size-thumb-lg shrink-0 rounded-md" />
          <div className="gap-xs flex flex-1 flex-col">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-40" />
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
 * Each row reads horizontally: thumbnail · product title + identifiers · detach.
 * The image + text area is a `<Link>` to the products page filtered by
 * `productId` so the seller can jump to the product context with one click.
 * The detach action sits outside the link to keep both behaviors independent.
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
    <ul className="divide-border divide-y">
      {variants.map((variant) => (
        <li key={variant.linkId} className="gap-sm group flex items-center py-3">
          <Link
            href={{ pathname: '/products', query: { productId: variant.productId } }}
            className="gap-sm focus-visible:ring-ring/40 flex min-w-0 flex-1 items-center rounded-md outline-none focus-visible:ring-2"
            aria-label={t('viewProductLabel', { title: variant.productTitle })}
          >
            <ImageCell
              src={variant.productImageUrl}
              alt={variant.productTitle}
              size="lg"
              fallback="icon"
            />
            <div className="gap-3xs flex min-w-0 flex-1 flex-col">
              <span className="text-foreground group-hover:text-primary truncate text-sm font-medium transition-colors">
                {variant.productTitle}
              </span>
              <div className="gap-sm text-muted-foreground flex items-center text-xs">
                <span className="tabular-nums">{variant.stockCode}</span>
                <span aria-hidden="true">·</span>
                <TimeAgo value={variant.attachedAt} />
              </div>
            </div>
            <ArrowRight02Icon className="text-muted-foreground/40 size-icon-sm group-hover:text-foreground/60 shrink-0 transition-colors" />
          </Link>

          <Button
            variant="ghost"
            size="sm"
            aria-label={t('detachLabel', { stockCode: variant.stockCode })}
            disabled={detach.isPending}
            onClick={() => handleDetach(variant)}
          >
            {t('detach')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
