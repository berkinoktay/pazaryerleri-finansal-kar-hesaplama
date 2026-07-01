'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';

import { useCommissionTariffList } from '../hooks/use-commission-tariff-list';
import { useDeleteTariff } from '../hooks/use-delete-tariff';
import { useExportTariff } from '../hooks/use-export-tariff';
import { useImportTariff } from '../hooks/use-import-tariff';
import { downloadBlob } from '../lib/download-blob';
import { extractFileErrorCode } from '../lib/upload-error';
import { CommissionTariffsListView } from './commission-tariffs-list-view';
import { CommissionTariffUploadDialog } from './commission-tariff-upload-dialog';

const DETAIL_BASE = '/campaigns/product-commission-tariffs';

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
  const importTariff = useImportTariff(orgId ?? '', storeId ?? '');
  const deleteTariff = useDeleteTariff(orgId ?? '', storeId ?? '');
  const exportTariff = useExportTariff(orgId ?? '', storeId ?? '');
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const items = React.useMemo(() => list.data ?? [], [list.data]);

  const openDetail = React.useCallback(
    (id: string) => router.push(`${DETAIL_BASE}/${id}`),
    [router],
  );

  const handleImport = React.useCallback(
    (file: File): void => {
      importTariff.mutate(
        { file },
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

  if (list.isLoading) {
    return (
      <div className="gap-lg flex flex-col">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
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
      <CommissionTariffsListView
        items={items}
        onOpen={openDetail}
        onCreate={() => setUploadOpen(true)}
        onExport={handleExport}
        onDelete={handleDelete}
      />
      <CommissionTariffUploadDialog
        open={uploadOpen}
        onOpenChange={(next) => {
          if (!next) importTariff.reset();
          setUploadOpen(next);
        }}
        onFile={(file) => handleImport(file)}
        submitting={importTariff.isPending}
        errorCode={extractFileErrorCode(importTariff.error)}
        onResetError={() => importTariff.reset()}
      />
    </>
  );
}
