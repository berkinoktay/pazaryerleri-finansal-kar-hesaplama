'use client';

import { ArrowLeft02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { TimeAgo } from '@/components/patterns/time-ago';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Link } from '@/i18n/navigation';

import type { CostProfileFormValues } from '../validation/cost-profile.schema';
import { useCostProfile } from '../hooks/use-cost-profile';
import { useCostProfileVersions } from '../hooks/use-cost-profile-versions';
import { useCostProfileAttachedVariants } from '../hooks/use-cost-profile-attached-variants';
import { useArchiveCostProfile } from '../hooks/use-archive-cost-profile';
import { useRestoreCostProfile } from '../hooks/use-restore-cost-profile';
import { useUpdateCostProfile } from '../hooks/use-update-cost-profile';
import { CostProfileTypeBadge } from './cost-profile-type-badge';
import { CostProfileForm, profileToFormValues } from './cost-profile-form';
import { CostProfileHistoryList } from './cost-profile-history-list';
import { CostProfileAttachedVariants } from './cost-profile-attached-variants';

import type { CostProfileType } from '../types/cost-profile.types';

// ─── Tab values (stable strings used as Radix value) ─────────────────────────
const TAB_DETAIL = 'detail' as const;
const TAB_HISTORY = 'history' as const;
const TAB_VARIANTS = 'variants' as const;

type TabValue = typeof TAB_DETAIL | typeof TAB_HISTORY | typeof TAB_VARIANTS;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CostProfileDetailProps {
  orgId: string;
  profileId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Full detail view for a cost profile — mounted by the [profileId]/page route.
 *
 * Layout:
 *   PageHeader with breadcrumb (leading) · title · type + archive badges · meta
 *   ─────────────────────────────────────────────────────────────────────────
 *   Tabs: Detay / Geçmiş / Bağlı varyantlar
 *     Detay tab            → form inside a Card
 *     Geçmiş tab           → reverse-chronological event timeline (inline diff)
 *     Bağlı varyantlar tab → image-led list with deep link to /products
 *
 * @useWhen rendering the full detail page for a single cost profile
 */
export function CostProfileDetail({
  orgId,
  profileId,
}: CostProfileDetailProps): React.ReactElement {
  const tDetail = useTranslations('costs.detail');
  const tCommon = useTranslations('common');

  // ─── State ─────────────────────────────────────────────────────────────
  const [archiveConfirmOpen, setArchiveConfirmOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<TabValue>(TAB_DETAIL);

  // ─── Queries ────────────────────────────────────────────────────────────
  const { data: profile, isLoading: profileLoading } = useCostProfile(orgId, profileId);
  const { data: versionsData, isLoading: versionsLoading } = useCostProfileVersions(
    orgId,
    profileId,
  );
  const { data: variantsData, isLoading: variantsLoading } = useCostProfileAttachedVariants(
    orgId,
    profileId,
  );

  const versions = versionsData?.data ?? [];
  const variants = variantsData?.data ?? [];
  const isArchived = profile?.archivedAt !== null && profile?.archivedAt !== undefined;

  // ─── Mutations ──────────────────────────────────────────────────────────
  const archive = useArchiveCostProfile();
  const restore = useRestoreCostProfile();
  const update = useUpdateCostProfile();

  function handleArchiveConfirm() {
    return new Promise<void>((resolve, reject) => {
      archive.mutate(
        { orgId, profileId },
        {
          onSuccess: () => {
            setArchiveConfirmOpen(false);
            resolve();
          },
          onError: reject,
        },
      );
    });
  }

  function handleRestore() {
    restore.mutate({ orgId, profileId });
  }

  function handleFormSubmit(values: CostProfileFormValues) {
    update.mutate({
      orgId,
      profileId,
      body: {
        name: values.name,
        type: values.type,
        currency: values.currency,
        amountGross: values.amountGross,
        vatRate: values.vatRate,
        fxRateMode: values.fxRateMode,
        manualFxRate: values.manualFxRate ?? undefined,
        note: values.note ?? undefined,
      },
    });
  }

  // The whole screen (header title/meta/actions, tab counts, form) hangs off
  // the profile query, so a full page-anatomy placeholder beats a '…' title
  // with three generic bars. Rendered after all hooks, so this early return
  // is safe; tab state resets only if the component unmounts, not here.
  if (profileLoading) {
    return <PageSkeleton label={tCommon('loading')} withBackLink />;
  }

  // ─── Header slots ───────────────────────────────────────────────────────

  const headerLeading = (
    <>
      <Link
        href="/costs"
        className="hover:text-foreground gap-3xs flex items-center transition-colors"
      >
        <ArrowLeft02Icon className="size-icon-xs" />
        {tDetail('header.backToList')}
      </Link>
    </>
  );

  const headerMeta = profile ? (
    <div className="gap-sm flex flex-wrap items-center">
      <CostProfileTypeBadge type={profile.type as CostProfileType} />
      {isArchived ? (
        <Badge tone="warning" size="sm">
          {tDetail('header.archivedBadge')}
        </Badge>
      ) : null}
      <span className="text-muted-foreground/60 text-xs">·</span>
      <span className="text-muted-foreground text-xs">
        {tDetail('header.lastUpdated')}{' '}
        <TimeAgo value={profile.updatedAt} className="text-foreground" />
      </span>
    </div>
  ) : null;

  const headerActions = profile ? (
    isArchived ? (
      <Button variant="outline" size="sm" onClick={handleRestore} disabled={restore.isPending}>
        {tDetail('actions.restore')}
      </Button>
    ) : (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setArchiveConfirmOpen(true)}
        disabled={archive.isPending}
        className="text-warning hover:text-warning hover:border-warning/40"
      >
        {tDetail('actions.archive')}
      </Button>
    )
  ) : null;

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader
        title={profile?.name ?? profileId}
        leading={headerLeading}
        meta={headerMeta}
        actions={headerActions}
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          if (v === TAB_DETAIL || v === TAB_HISTORY || v === TAB_VARIANTS) {
            setActiveTab(v);
          }
        }}
        variant="underline"
      >
        <TabsList>
          <TabsTrigger value={TAB_DETAIL}>{tDetail('tabs.detail')}</TabsTrigger>
          <TabsTrigger value={TAB_HISTORY}>
            {tDetail('tabs.history')}
            {versions.length > 0 ? (
              <span className="bg-muted text-muted-foreground ml-xs text-2xs rounded-full px-1.5 py-px font-medium tabular-nums">
                {versions.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value={TAB_VARIANTS}>
            {tDetail('tabs.attachedVariants')}
            {variants.length > 0 ? (
              <span className="bg-muted text-muted-foreground ml-xs text-2xs rounded-full px-1.5 py-px font-medium tabular-nums">
                {variants.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* ── Detay tab ─────────────────────────────────────────── */}
        <TabsContent value={TAB_DETAIL} className="mt-lg">
          <Card>
            <CardHeader>
              <h2 className="text-foreground text-sm font-semibold">
                {tDetail('detailTab.title')}
              </h2>
              <p className="text-muted-foreground text-xs">{tDetail('detailTab.description')}</p>
            </CardHeader>
            <CardContent>
              {/* Loading early-returns above; this fallback only covers a
                  resolved-but-missing profile (e.g. a failed fetch). */}
              {profile === undefined ? (
                <div className="gap-md flex flex-col">
                  <Skeleton className="max-w-form h-10 w-full" />
                  <Skeleton className="max-w-form h-10 w-full" />
                  <Skeleton className="max-w-form h-10 w-full" />
                </div>
              ) : (
                <div className="max-w-form">
                  <CostProfileForm
                    orgId={orgId}
                    initialValues={profileToFormValues(profile)}
                    onSubmit={handleFormSubmit}
                    onCancel={() => {
                      // Reset to last saved — parent re-fetches after successful update
                    }}
                    isSubmitting={update.isPending}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Geçmiş tab ────────────────────────────────────────── */}
        <TabsContent value={TAB_HISTORY} className="mt-lg">
          <Card>
            <CardHeader>
              <h2 className="text-foreground text-sm font-semibold">
                {tDetail('historyTab.title')}
              </h2>
              <p className="text-muted-foreground text-xs">{tDetail('historyTab.description')}</p>
            </CardHeader>
            <CardContent>
              <CostProfileHistoryList versions={versions} isLoading={versionsLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Bağlı varyantlar tab ──────────────────────────────── */}
        <TabsContent value={TAB_VARIANTS} className="mt-lg">
          <Card>
            <CardHeader>
              <h2 className="text-foreground text-sm font-semibold">
                {tDetail('variantsTab.title')}
              </h2>
              <p className="text-muted-foreground text-xs">{tDetail('variantsTab.description')}</p>
            </CardHeader>
            <CardContent>
              <CostProfileAttachedVariants
                orgId={orgId}
                profileId={profileId}
                variants={variants}
                isLoading={variantsLoading}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Archive confirmation dialog */}
      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title={tDetail('archiveConfirm.title')}
        description={tDetail('archiveConfirm.description')}
        tone="default"
        confirmLabel={tDetail('archiveConfirm.confirm')}
        cancelLabel={tDetail('archiveConfirm.cancel')}
        onConfirm={handleArchiveConfirm}
        loading={archive.isPending}
      />
    </div>
  );
}
