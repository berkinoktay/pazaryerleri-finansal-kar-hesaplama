'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { PageHeader } from '@/components/patterns/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CostProfileDetailProps {
  orgId: string;
  profileId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Full detail view for a cost profile — mounted by the [profileId]/page route.
 *
 * Three tabs:
 *   - Detay:             editable form (pre-filled via profileToFormValues)
 *   - Geçmiş:           reverse-chronological version history
 *   - Bağlı varyantlar: attached product variants with detach action
 *
 * The page header carries the profile name, type badge, archive status,
 * and an archive / restore action button with a ConfirmDialog guard.
 *
 * @useWhen rendering the full detail page for a single cost profile
 */
export function CostProfileDetail({
  orgId,
  profileId,
}: CostProfileDetailProps): React.ReactElement {
  const tDetail = useTranslations('costs.detail');

  // ─── State ─────────────────────────────────────────────────────────────
  const [archiveConfirmOpen, setArchiveConfirmOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<
    typeof TAB_DETAIL | typeof TAB_HISTORY | typeof TAB_VARIANTS
  >(TAB_DETAIL);

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
        amount: values.amount,
        vatRate: values.vatRate,
        fxRateMode: values.fxRateMode,
        manualFxRate: values.manualFxRate ?? undefined,
        note: values.note ?? undefined,
      },
    });
  }

  // ─── Header actions ──────────────────────────────────────────────────────
  const headerActions = (
    <>
      {isArchived ? (
        <Button variant="outline" size="sm" onClick={handleRestore} disabled={restore.isPending}>
          {tDetail('actions.restore')}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setArchiveConfirmOpen(true)}
          disabled={archive.isPending}
        >
          {tDetail('actions.archive')}
        </Button>
      )}
    </>
  );

  // ─── Heading meta row (type badge + archived badge) ─────────────────────
  const headingMeta = profile ? (
    <div className="gap-xs flex items-center">
      <CostProfileTypeBadge type={profile.type as CostProfileType} />
      {isArchived ? (
        <Badge tone="warning" size="sm">
          {tDetail('header.archivedBadge')}
        </Badge>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="gap-lg flex flex-col">
      {/* Back-link breadcrumb */}
      <div className="gap-xs text-2xs text-muted-foreground flex items-center">
        <Link href="/costs" className="hover:text-foreground transition-colors">
          {tDetail('header.backToList')}
        </Link>
        <span>/</span>
        {profileLoading ? (
          <Skeleton className="h-3 w-32" />
        ) : (
          <span className="text-foreground">{profile?.name ?? profileId}</span>
        )}
      </div>

      <PageHeader
        title={profileLoading ? '…' : (profile?.name ?? profileId)}
        meta={headingMeta}
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
          <TabsTrigger value={TAB_HISTORY}>{tDetail('tabs.history')}</TabsTrigger>
          <TabsTrigger value={TAB_VARIANTS}>{tDetail('tabs.attachedVariants')}</TabsTrigger>
        </TabsList>

        {/* ── Detay tab ─────────────────────────────────────────── */}
        <TabsContent value={TAB_DETAIL}>
          {profileLoading || profile === undefined ? (
            <div className="gap-md flex flex-col">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <CostProfileForm
              initialValues={profileToFormValues(profile)}
              onSubmit={handleFormSubmit}
              onCancel={() => {
                // Reset to last saved — parent re-fetches after successful update
              }}
              isSubmitting={update.isPending}
            />
          )}
        </TabsContent>

        {/* ── Geçmiş tab ────────────────────────────────────────── */}
        <TabsContent value={TAB_HISTORY}>
          <CostProfileHistoryList versions={versions} isLoading={versionsLoading} />
        </TabsContent>

        {/* ── Bağlı varyantlar tab ──────────────────────────────── */}
        <TabsContent value={TAB_VARIANTS}>
          <CostProfileAttachedVariants
            orgId={orgId}
            profileId={profileId}
            variants={variants}
            isLoading={variantsLoading}
          />
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
