'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

import { useAdvantageTariffList } from '../hooks/use-advantage-tariff-list';
import { useDeleteAdvantageTariff } from '../hooks/use-delete-advantage-tariff';
import { useExportAdvantageTariff } from '../hooks/use-export-advantage-tariff';
import { useImportAdvantageTariff } from '../hooks/use-import-advantage-tariff';
import { downloadBlob } from '../lib/download-blob';
import { extractFileErrorCode } from '../lib/upload-error';
import { AdvantageTariffUploadDialog } from './advantage-tariff-upload-dialog';
import { AdvantageTariffsListView } from './advantage-tariffs-list-view';

const DETAIL_BASE = '/campaigns/product-labels';

/**
 * Data-bound LIST screen for Advantage product labels. Resolves org/store from
 * the server (passed as props), lists the saved tariffs, and drives upload
 * (→ navigate to the new tariff), export (→ download the patched xlsx), and
 * delete through the feature hooks. Opening a row navigates to the `[tariffId]`
 * detail route.
 */
export function AdvantageTariffsListClient({
  orgId,
  storeId,
}: {
  orgId: string | null;
  storeId: string | null;
}): React.ReactElement {
  const tPage = useTranslations('productLabelsPage');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const list = useAdvantageTariffList(orgId ?? '', storeId);
  const importTariff = useImportAdvantageTariff(orgId ?? '', storeId ?? '');
  const deleteTariff = useDeleteAdvantageTariff(orgId ?? '', storeId ?? '');
  const exportTariff = useExportAdvantageTariff(orgId ?? '', storeId ?? '');
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const items = React.useMemo(() => list.data ?? [], [list.data]);

  const openDetail = React.useCallback(
    (id: string) => router.push(`${DETAIL_BASE}/${id}`),
    [router],
  );

  const handleImport = React.useCallback(
    (file: File, commissionSourceTariffId: string | undefined): void => {
      importTariff.mutate(
        { file, commissionSourceTariffId },
        {
          onSuccess: (result) => {
            setUploadOpen(false);
            openDetail(result.tariffId);
          },
        },
      );
    },
    [importTariff, openDetail],
  );

  const handleExport = React.useCallback(
    (id: string): void => {
      const name = items.find((item) => item.id === id)?.name ?? id;
      exportTariff.mutate(id, {
        onSuccess: (blob) => downloadBlob(blob, `${name}.xlsx`),
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
    <>
      {/* While the list query is in flight the REAL chrome renders with
          skeleton data (summary cells, tab counts, table rows) instead of a
          generic gray-bar page — PageHeader title/intent are static i18n. */}
      <AdvantageTariffsListView
        items={items}
        loading={list.isLoading}
        onOpen={openDetail}
        onCreate={() => setUploadOpen(true)}
        onExport={handleExport}
        onDelete={handleDelete}
      />
      <AdvantageTariffUploadDialog
        open={uploadOpen}
        orgId={orgId}
        storeId={storeId}
        onOpenChange={(next) => {
          if (!next) importTariff.reset();
          setUploadOpen(next);
        }}
        onFile={handleImport}
        submitting={importTariff.isPending}
        errorCode={extractFileErrorCode(importTariff.error)}
        onResetError={() => importTariff.reset()}
      />
    </>
  );
}
