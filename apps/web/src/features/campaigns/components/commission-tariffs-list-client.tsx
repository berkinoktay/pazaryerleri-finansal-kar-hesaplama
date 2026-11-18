'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

import type { WorkbookImportInput } from '../api/workbook-endpoints';
import { useCommissionTariffList } from '../hooks/use-commission-tariff-list';
import { useDeleteTariff } from '../hooks/use-delete-tariff';
import { useExportWorkbook } from '../hooks/use-export-workbook';
import { useImportWorkbook } from '../hooks/use-import-workbook';
import { usePrefilledWarning } from '../hooks/use-prefilled-warning';
import { useResolvedCampaignAccess } from '../hooks/use-resolved-campaign-access';
import { useUnknownPriceWarning } from '../hooks/use-unknown-price-warning';
import { UPLOAD_GATES } from '../lib/campaign-access';
import { CampaignAccessProvider } from '../lib/campaign-access-context';
import { downloadBlob } from '../lib/download-blob';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';
import { CommissionTariffsListView } from './commission-tariffs-list-view';
import { WorkbookUploadDialog } from './workbook-upload-dialog';

const PAGE = WORKBOOK_PAGES.COMMISSION_TARIFF;
const DETAIL_BASE = WORKBOOK_VERTICALS[PAGE].detailBase;

/**
 * Data-bound LIST screen for Product Commission Tariffs. Resolves org/store from
 * the server (passed as props), lists the saved tariffs, and drives upload
 * (→ navigate to the new tariff), export (→ download the patched xlsx), and
 * delete through the feature hooks. Opening a row navigates to the `[tariffId]`
 * detail route.
 */
export function CommissionTariffsListClient({
  orgId,
  storeId,
}: {
  orgId: string | null;
  storeId: string | null;
}): React.ReactElement {
  const tPage = useTranslations('commissionTariffsPage');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const list = useCommissionTariffList(orgId ?? '', storeId);
  const importTariff = useImportWorkbook(PAGE, orgId ?? '', storeId ?? '');
  const deleteTariff = useDeleteTariff(orgId ?? '', storeId ?? '');
  const exportTariff = useExportWorkbook(PAGE, orgId ?? '', storeId ?? '');
  const warnPrefilled = usePrefilledWarning();
  const warnUnknownPrice = useUnknownPriceWarning(PAGE);
  const access = useResolvedCampaignAccess(PAGE);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const items = React.useMemo(() => list.data ?? [], [list.data]);

  const openDetail = React.useCallback(
    (id: string) => router.push(`${DETAIL_BASE}/${id}`),
    [router],
  );

  const handleImport = React.useCallback(
    (input: WorkbookImportInput): void => {
      importTariff.mutate(input, {
        onSuccess: (result) => {
          setUploadOpen(false);
          warnPrefilled(result.prefilledRows);
          warnUnknownPrice(result);
          openDetail(result.id);
        },
      });
    },
    [importTariff, openDetail, warnPrefilled, warnUnknownPrice],
  );

  const handleExport = React.useCallback(
    (id: string): void => {
      const name = items.find((item) => item.id === id)?.name ?? id;
      exportTariff.mutate(id, {
        // Filename comes from the server (a split week downloads a `.zip`); fall back
        // to the tariff name only if the header was absent.
        onSuccess: (file) => downloadBlob(file.blob, file.filename ?? `${name}.xlsx`),
      });
    },
    [exportTariff, items],
  );

  const handleDelete = React.useCallback((id: string) => deleteTariff.mutate(id), [deleteTariff]);

  // No store selected: the query is disabled and every action needs a store, so
  // show a store-selection state instead of the interactive list (whose upload
  // would POST with an empty scope). Mirrors the detail screen's scope guard.
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

  // A failed fetch is NOT an empty catalog — show a retry affordance rather than
  // the "no tariffs yet" empty state the list view renders on `items: []`.
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
      {/* While the list query is in flight the REAL chrome renders with
          skeleton data (summary cells, tab counts, table rows) instead of a
          generic gray-bar page — PageHeader title/intent are static i18n. */}
      <CommissionTariffsListView
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
            if (!next) importTariff.reset();
            setUploadOpen(next);
          }}
          scope={{ orgId, storeId }}
          onSubmit={handleImport}
          submitting={importTariff.isPending}
          submitError={importTariff.error}
          onResetError={() => importTariff.reset()}
        />
      ) : null}
    </CampaignAccessProvider>
  );
}
