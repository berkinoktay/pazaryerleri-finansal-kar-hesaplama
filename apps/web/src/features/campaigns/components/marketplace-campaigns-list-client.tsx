'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

import type { WorkbookImportInput } from '../api/workbook-endpoints';
import { useDeleteMarketplaceCampaign } from '../hooks/use-delete-marketplace-campaign';
import { useExportWorkbook } from '../hooks/use-export-workbook';
import { useImportWorkbook } from '../hooks/use-import-workbook';
import { useMarketplaceCampaigns } from '../hooks/use-marketplace-campaigns';
import { usePrefilledWarning } from '../hooks/use-prefilled-warning';
import { useResolvedCampaignAccess } from '../hooks/use-resolved-campaign-access';
import { UPLOAD_GATES } from '../lib/campaign-access';
import { CampaignAccessProvider } from '../lib/campaign-access-context';
import { downloadBlob } from '../lib/download-blob';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';
import { MarketplaceCampaignsListView } from './marketplace-campaigns-list-view';
import { WorkbookUploadDialog } from './workbook-upload-dialog';

const PAGE = WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST;
const DETAIL_BASE = WORKBOOK_VERTICALS[PAGE].detailBase;

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
  const { mutate: exportCampaign } = useExportWorkbook(PAGE, orgId ?? '', storeId ?? '');
  const {
    mutate: importCampaign,
    isPending: importing,
    error: importError,
    reset: resetImport,
  } = useImportWorkbook(PAGE, orgId ?? '', storeId ?? '');
  const warnPrefilled = usePrefilledWarning();
  const access = useResolvedCampaignAccess(PAGE);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const items = React.useMemo(() => list.data ?? [], [list.data]);

  const openDetail = React.useCallback(
    (id: string) => router.push(`${DETAIL_BASE}/${id}`),
    [router],
  );

  const handleImport = React.useCallback(
    (input: WorkbookImportInput): void => {
      importCampaign(input, {
        onSuccess: (result) => {
          setUploadOpen(false);
          warnPrefilled(result.prefilledRows);
          openDetail(result.id);
        },
      });
    },
    [importCampaign, openDetail, warnPrefilled],
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
    <CampaignAccessProvider value={access}>
      <MarketplaceCampaignsListView
        items={items}
        loading={list.isLoading}
        onOpen={openDetail}
        onCreate={() => setUploadOpen(true)}
        onExport={handleExport}
        onDelete={handleDelete}
      />
      {access.upload === UPLOAD_GATES.ENABLED ? (
        <WorkbookUploadDialog
          page={PAGE}
          open={uploadOpen}
          onOpenChange={(next) => {
            if (!next) resetImport();
            setUploadOpen(next);
          }}
          scope={{ orgId, storeId }}
          onSubmit={handleImport}
          submitting={importing}
          submitError={importError}
          onResetError={resetImport}
        />
      ) : null}
    </CampaignAccessProvider>
  );
}
