'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

import { useDeleteMarketplaceCampaign } from '../hooks/use-delete-marketplace-campaign';
import { useExportMarketplaceCampaign } from '../hooks/use-export-marketplace-campaign';
import { useImportMarketplaceCampaign } from '../hooks/use-import-marketplace-campaign';
import { useMarketplaceCampaigns } from '../hooks/use-marketplace-campaigns';
import { downloadBlob } from '../lib/download-blob';
import { extractFileErrorCode } from '../lib/upload-error';
import { MarketplaceCampaignUploadDialog } from './marketplace-campaign-upload-dialog';
import { MarketplaceCampaignsListView } from './marketplace-campaigns-list-view';

const DETAIL_BASE = '/campaigns/marketplace-campaigns';

/**
 * Data-bound LIST screen for Kampanyalar. Resolves org/store from the server (passed as props),
 * lists the saved uploads, and drives upload (→ navigate to the new campaign), export
 * (→ download the patched xlsx) and delete through the feature hooks. Opening a row navigates to
 * the `[campaignId]` detail route.
 */
export function MarketplaceCampaignsListClient({
  orgId,
  storeId,
}: {
  orgId: string | null;
  storeId: string | null;
}): React.ReactElement {
  const tPage = useTranslations('marketplaceCampaignsPage');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const list = useMarketplaceCampaigns(orgId ?? '', storeId);
  // Only the identity-stable `mutate` is kept: the mutation result object is new on every render,
  // and `handleExport` feeds the row actions → the table's columns, whose rebuild remounts every
  // cell (closing an open row menu).
  const { mutate: deleteCampaign } = useDeleteMarketplaceCampaign(orgId ?? '', storeId ?? '');
  const { mutate: exportCampaign } = useExportMarketplaceCampaign(orgId ?? '', storeId ?? '');
  const {
    mutate: importCampaign,
    isPending: importing,
    error: importError,
    reset: resetImport,
  } = useImportMarketplaceCampaign(orgId ?? '', storeId ?? '');
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const items = React.useMemo(() => list.data ?? [], [list.data]);

  const openDetail = React.useCallback(
    (id: string) => router.push(`${DETAIL_BASE}/${id}`),
    [router],
  );

  const handleImport = React.useCallback<
    React.ComponentProps<typeof MarketplaceCampaignUploadDialog>['onSubmit']
  >(
    (config, file, name) => {
      importCampaign(
        { file, name, config },
        {
          onSuccess: (result) => {
            setUploadOpen(false);
            openDetail(result.campaignId);
          },
        },
      );
    },
    [importCampaign, openDetail],
  );

  const handleExport = React.useCallback(
    (id: string): void => {
      const name = items.find((item) => item.id === id)?.name ?? id;
      exportCampaign(id, {
        // Filename comes from the server (Content-Disposition); fall back to the campaign name.
        onSuccess: (file) => downloadBlob(file.blob, file.filename ?? `${name}.xlsx`),
      });
    },
    [exportCampaign, items],
  );

  const handleDelete = React.useCallback((id: string) => deleteCampaign(id), [deleteCampaign]);

  // No store selected: the query is disabled and every action needs a store, so show a
  // store-selection state instead of the interactive list (whose upload would POST with an
  // empty scope).
  if (orgId === null || storeId === null) {
    return (
      <EmptyState
        title={tPage('noStore.title')}
        description={tPage('noStore.description')}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/stores">{tPage('noStore.cta')}</Link>
          </Button>
        }
      />
    );
  }

  // A failed fetch is NOT an empty list — show a retry affordance rather than the "no uploads
  // yet" empty state the list view renders on `items: []`.
  if (list.isError) {
    return (
      <EmptyState
        title={tCommon('stat.loadError')}
        action={
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {tCommon('stat.retry')}
          </Button>
        }
      />
    );
  }

  return (
    <>
      <MarketplaceCampaignsListView
        items={items}
        loading={list.isLoading}
        onOpen={openDetail}
        onCreate={() => setUploadOpen(true)}
        onExport={handleExport}
        onDelete={handleDelete}
      />
      <MarketplaceCampaignUploadDialog
        open={uploadOpen}
        onOpenChange={(next) => {
          if (!next) resetImport();
          setUploadOpen(next);
        }}
        onSubmit={handleImport}
        submitting={importing}
        errorCode={extractFileErrorCode(importError)}
        submitError={importError}
        onResetError={resetImport}
      />
    </>
  );
}
