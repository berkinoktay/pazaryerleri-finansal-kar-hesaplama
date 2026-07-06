'use client';

import { PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { parseAsBoolean, parseAsString, parseAsStringEnum, useQueryStates } from 'nuqs';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';

import { CostProfileType, type CostProfile } from '../types/cost-profile.types';
import { useCostProfilesInfinite } from '../hooks/use-cost-profiles';
import { useCostsFilterFields } from '../hooks/use-costs-filter-fields';
import { costsFilterParamsFromRows, costsFilterRowsFromParams } from '../lib/costs-filter-fields';
import { useArchiveCostProfile } from '../hooks/use-archive-cost-profile';
import { useRestoreCostProfile } from '../hooks/use-restore-cost-profile';

import { CostProfileCreateDialog } from './cost-profile-create-dialog';
import { CostProfileEmptyState } from './cost-profile-empty-state';
import { CostProfileTable } from './cost-profile-table';

interface CostsPageClientProps {
  orgId: string | null;
}

/**
 * Client shell for the /costs list page.
 *
 * Owns filter state, dialog state, and wires query + mutation hooks.
 * The server page shell (app/[locale]/(dashboard)/costs/page.tsx) resolves
 * orgId and hands it here.
 */
export function CostsPageClient({ orgId }: CostsPageClientProps): React.ReactElement {
  const t = useTranslations('costs');

  // ─── Filter state — URL-owned (nuqs): reload/share reproduces the view. ──
  const [filters, setFilters] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      type: parseAsStringEnum<CostProfileType>([...Object.values(CostProfileType)]),
      archived: parseAsBoolean.withDefault(false),
    },
    { history: 'push' },
  );
  const q = filters.q;
  const typeFilter: CostProfileType | '' = filters.type ?? '';
  const showArchived = filters.archived;

  // Search keeps a local echo so each keystroke doesn't push a history entry;
  // the settled value lands in the URL (and the server query) after ~250ms
  // idle. Mirrors the products page pattern.
  const [qInput, setQInput] = React.useState(q);
  React.useEffect(() => {
    if (qInput === q) return;
    const handle = window.setTimeout(() => void setFilters({ q: qInput }), 250);
    return () => window.clearTimeout(handle);
  }, [qInput, q, setFilters]);

  // ─── Dialog state ───────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editProfile, setEditProfile] = React.useState<CostProfile | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<CostProfile | null>(null);

  // ─── Queries (cursor-paginated — every page reachable via load-more) ────
  const query = useCostProfilesInfinite(
    orgId !== null
      ? {
          orgId,
          filters: {
            ...(q.length > 0 ? { q } : {}),
            ...(showArchived ? { archived: 'true' as const } : {}),
            ...(typeFilter.length > 0 ? { type: typeFilter } : {}),
          },
        }
      : null,
  );
  const isLoading = query.isLoading;
  const profiles = query.data?.pages.flatMap((page) => page.data) ?? [];

  const filterFields = useCostsFilterFields();
  const filterRows = costsFilterRowsFromParams({ typeFilter, showArchived });
  const hasActiveFilters = q.length > 0 || typeFilter.length > 0 || showArchived;
  const handleClearFilters = (): void => {
    setQInput('');
    void setFilters({ q: '', type: null, archived: false });
  };

  // ─── Mutations ──────────────────────────────────────────────────────────
  const archive = useArchiveCostProfile();
  const restore = useRestoreCostProfile();

  function handleArchiveClick(profile: CostProfile) {
    setArchiveTarget(profile);
  }

  function handleArchiveConfirm() {
    if (orgId === null || archiveTarget === null) return;
    archive.mutate(
      { orgId, profileId: archiveTarget.id },
      { onSuccess: () => setArchiveTarget(null) },
    );
  }

  function handleRestore(profile: CostProfile) {
    if (orgId === null) return;
    restore.mutate({ orgId, profileId: profile.id });
  }

  function handleEdit(profile: CostProfile) {
    setEditProfile(profile);
    setCreateOpen(true);
  }

  return (
    <div className="gap-lg flex flex-col">
      <PageHeader
        variant="framed"
        title={t('page.title')}
        intent={t('page.description')}
        actions={
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <PlusSignIcon className="size-icon-xs" />
            {t('page.createCta')}
          </Button>
        }
      />

      {/* The table chrome (toolbar + headers + pagination) ALWAYS renders so the
          page shape stays stable — loading shows skeleton rows, zero profiles
          shows the embedded empty state (with its "create first profile" CTA)
          INSIDE the table body instead of a full-page takeover that left the
          right side barren. Mirrors the Returns/Products gold standard. */}
      <CostProfileTable
        data={profiles}
        loading={isLoading}
        empty={<CostProfileEmptyState onCreateClick={() => setCreateOpen(true)} />}
        q={qInput}
        onSearchChange={setQInput}
        advancedFilter={{
          fields: filterFields,
          value: filterRows,
          onApply: (rows) => {
            const next = costsFilterParamsFromRows(rows);
            void setFilters({
              type: next.typeFilter === '' ? null : next.typeFilter,
              archived: next.showArchived,
            });
          },
        }}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
        hasMore={query.hasNextPage}
        onLoadMore={() => void query.fetchNextPage()}
        loadingMore={query.isFetchingNextPage}
        onEditClick={handleEdit}
        onArchiveClick={handleArchiveClick}
        onRestoreClick={handleRestore}
      />

      {orgId !== null ? (
        <CostProfileCreateDialog
          orgId={orgId}
          open={createOpen}
          editProfile={editProfile}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setEditProfile(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title={t('archive.confirmTitle')}
        description={t('archive.confirmDescription')}
        tone="default"
        confirmLabel={t('archive.confirm')}
        cancelLabel={t('archive.cancel')}
        onConfirm={handleArchiveConfirm}
        loading={archive.isPending}
      />
    </div>
  );
}
