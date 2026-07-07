'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

import { useFlashProductList } from '../hooks/use-flash-product-list';
import { useDeleteFlashProducts } from '../hooks/use-delete-flash-products';
import { useExportFlashProducts } from '../hooks/use-export-flash-products';
import { useImportFlashProducts } from '../hooks/use-import-flash-products';
import { downloadBlob } from '../lib/download-blob';
import { extractFileErrorCode } from '../lib/upload-error';
import { FlashProductUploadDialog } from './flash-product-upload-dialog';
import { FlashProductsListView } from './flash-products-list-view';

const DETAIL_BASE = '/campaigns/flash-products';

/**
 * Data-bound LIST screen for Flash Products. Resolves org/store from the server (passed as
 * props), lists the saved uploads, and drives upload (→ navigate to the new upload), export
 * (→ download the patched xlsx), and delete through the feature hooks. Opening a row
 * navigates to the `[listId]` detail route.
 */
export function FlashProductsListClient({
  orgId,
  storeId,
}: {
  orgId: string | null;
  storeId: string | null;
}): React.ReactElement {
  const tPage = useTranslations('flashProductsPage');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const list = useFlashProductList(orgId ?? '', storeId);
  const importList = useImportFlashProducts(orgId ?? '', storeId ?? '');
  const deleteList = useDeleteFlashProducts(orgId ?? '', storeId ?? '');
  const exportList = useExportFlashProducts(orgId ?? '', storeId ?? '');
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const items = React.useMemo(() => list.data ?? [], [list.data]);

  const openDetail = React.useCallback(
    (id: string) => router.push(`${DETAIL_BASE}/${id}`),
    [router],
  );

  const handleImport = React.useCallback(
    (file: File): void => {
      importList.mutate(
        { file },
        {
          onSuccess: (result) => {
            setUploadOpen(false);
            openDetail(result.listId);
          },
        },
      );
    },
    [importList, openDetail],
  );

  const handleExport = React.useCallback(
    (id: string): void => {
      const name = items.find((item) => item.id === id)?.name ?? id;
      exportList.mutate(id, {
        // Filename comes from the server (Content-Disposition); fall back to the list name.
        onSuccess: (file) => downloadBlob(file.blob, file.filename ?? `${name}.xlsx`),
      });
    },
    [exportList, items],
  );

  const handleDelete = React.useCallback((id: string) => deleteList.mutate(id), [deleteList]);

  // No store selected: the query is disabled and every action needs a store, so show a
  // store-selection state instead of the interactive list (whose upload would POST with an
  // empty scope). Mirrors the detail screen's scope guard.
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

  // A failed fetch is NOT an empty catalog — show a retry affordance rather than the "no
  // uploads yet" empty state the list view renders on `items: []`.
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
      {/* While the list query is in flight the REAL chrome renders with skeleton data
          (summary cells, tab counts, table rows) instead of a generic gray-bar page —
          PageHeader title/intent are static i18n. */}
      <FlashProductsListView
        items={items}
        loading={list.isLoading}
        onOpen={openDetail}
        onCreate={() => setUploadOpen(true)}
        onExport={handleExport}
        onDelete={handleDelete}
      />
      <FlashProductUploadDialog
        open={uploadOpen}
        onOpenChange={(next) => {
          if (!next) importList.reset();
          setUploadOpen(next);
        }}
        onFile={handleImport}
        submitting={importList.isPending}
        errorCode={extractFileErrorCode(importList.error)}
        onResetError={() => importList.reset()}
      />
    </>
  );
}
