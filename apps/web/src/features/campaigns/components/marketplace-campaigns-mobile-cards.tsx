'use client';

import { Megaphone01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { DataTableRowActions, type RowAction } from '@/components/patterns/data-table-row-actions';
import { TableNoResultsState } from '@/components/patterns/data-table-states';
import { DefinitionList } from '@/components/patterns/definition-list';
import { EmptyState } from '@/components/patterns/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { SoftSquareIcon } from '@/components/ui/soft-square-icon';

import { UPLOAD_GATES } from '../lib/campaign-access';
import { useCampaignAccess } from '../lib/campaign-access-context';
import { useDescribeDiscountConfig } from '../lib/discount-config';
import { statusForRow, type MarketplaceCampaignListRow } from '../lib/marketplace-campaign-list';

import { CampaignUploadButton } from './campaign-upload-button';
import { DiscountTypeBadge } from './discount-type-badge';
import { MarketplaceCampaignFundingBadge } from './marketplace-campaign-funding-badge';
import { MarketplaceCampaignPeriod } from './marketplace-campaign-period';
import { MarketplaceCampaignStatusBadge } from './marketplace-campaign-status-badge';

// Enough placeholder cards to fill a phone viewport without implying a real count.
const SKELETON_CARD_COUNT = 3;

export interface MarketplaceCampaignsMobileCardsProps {
  /** Already filtered (search + status) by the parent. */
  rows: readonly MarketplaceCampaignListRow[];
  actions: RowAction<MarketplaceCampaignListRow>[];
  onOpen: (id: string) => void;
  /** The first-run empty state's call to action (opens the upload dialog). */
  onUpload: () => void;
  /** Parent-computed "any filter active?" — splits no-results from the first-run empty state. */
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  /** List query in flight: placeholder cards instead of a misleading empty state. */
  loading?: boolean;
}

/**
 * Mobile layout of the Kampanyalar list (shown below `md`, where the desktop table is hidden):
 * one card per saved upload, read top to bottom — identity (name + kurgu summary + kebab), the
 * kurgu and Trendyol-funding chips, then the window / participation / export facts. The whole
 * card opens the campaign: the name is the card's single real button and stretches its hit area
 * over the card (`after:inset-0`), while the kebab sits above that layer — so there is no nested
 * interactive element and a menu pick never bubbles into an "open".
 */
export function MarketplaceCampaignsMobileCards({
  rows,
  actions,
  onOpen,
  onUpload,
  hasActiveFilters,
  onClearFilters,
  loading = false,
}: MarketplaceCampaignsMobileCardsProps): React.ReactElement {
  const tCols = useTranslations('marketplaceCampaignsPage.list.columns');
  const tEmpty = useTranslations('marketplaceCampaignsPage.list.empty');
  const tCommon = useTranslations('common');
  const describeConfig = useDescribeDiscountConfig();
  const { upload } = useCampaignAccess();

  if (loading) {
    return (
      <div role="status" aria-busy aria-label={tCommon('loading')} className="gap-sm flex flex-col">
        {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
          <Skeleton key={index} radius="lg" className="h-40 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return hasActiveFilters ? (
      <TableNoResultsState onClearFilters={onClearFilters} />
    ) : (
      <EmptyState
        icon={Megaphone01Icon}
        title={tEmpty('title')}
        description={tEmpty('description')}
        // The platform sentence stands once, at the tab row; here the button is only disabled.
        action={
          upload === UPLOAD_GATES.HIDDEN ? undefined : (
            <CampaignUploadButton withNote={false} label={tEmpty('cta')} onClick={onUpload} />
          )
        }
      />
    );
  }

  return (
    <ul className="gap-sm flex flex-col">
      {rows.map((row) => (
        <li
          key={row.id}
          className="border-border bg-card gap-md p-md relative flex flex-col rounded-lg border"
        >
          <div className="gap-sm flex items-start">
            <SoftSquareIcon tone="primary" variant="soft" size="md">
              <Megaphone01Icon />
            </SoftSquareIcon>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                className="text-foreground focus-visible:after:ring-ring block w-full cursor-pointer truncate text-left text-sm font-semibold after:absolute after:inset-0 after:rounded-lg after:content-[''] focus-visible:outline-none focus-visible:after:ring-2"
              >
                {row.name}
              </button>
              <div className="text-muted-foreground text-2xs truncate">{describeConfig(row)}</div>
            </div>
            {/* Above the stretched open-button layer, so the kebab stays its own target. */}
            <div className="relative z-10">
              <DataTableRowActions row={row} actions={actions} />
            </div>
          </div>

          <div className="gap-2xs flex flex-wrap items-center">
            <DiscountTypeBadge type={row.discountType} />
            <MarketplaceCampaignFundingBadge fundingPct={row.trendyolFundingPct} />
          </div>

          <DefinitionList
            dense
            alignRight
            items={[
              {
                id: 'period',
                term: tCols('period'),
                description: (
                  <MarketplaceCampaignPeriod startsAt={row.startsAt} endsAt={row.endsAt} />
                ),
              },
              {
                id: 'selected',
                term: tCols('selected'),
                description: (
                  <span className="tabular-nums">
                    <span className="text-foreground font-semibold">{row.selectedCount}</span>
                    <span className="text-muted-foreground">/{row.itemCount}</span>
                  </span>
                ),
              },
              {
                id: 'status',
                term: tCols('status'),
                description: <MarketplaceCampaignStatusBadge status={statusForRow(row)} />,
              },
            ]}
          />
        </li>
      ))}
    </ul>
  );
}
