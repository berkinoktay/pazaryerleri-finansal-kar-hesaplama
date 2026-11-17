'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

import type { WorkbookImportInput } from '../api/workbook-endpoints';
import { useFlashProductList } from '../hooks/use-flash-product-list';
import { useDeleteFlashProducts } from '../hooks/use-delete-flash-products';
import { useExportWorkbook } from '../hooks/use-export-workbook';
import { useImportWorkbook } from '../hooks/use-import-workbook';
import { usePrefilledWarning } from '../hooks/use-prefilled-warning';
import { useUnknownPriceWarning } from '../hooks/use-unknown-price-warning';
import { downloadBlob } from '../lib/download-blob';
import { WORKBOOK_VERTICALS } from '../lib/workbook-verticals';
import { FlashProductsListView } from './flash-products-list-view';
import { WorkbookUploadDialog } from './workbook-upload-dialog';

const PAGE = WORKBOOK_PAGES.FLASH_PRODUCT_LIST;
const DETAIL_BASE = WORKBOOK_VERTICALS[PAGE].detailBase;

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
  const importList = useImportWorkbook(PAGE, orgId ?? '', storeId ?? '');
  const deleteList = useDeleteFlashProducts(orgId ?? '', storeId ?? '');
  const exportList = useExportWorkbook(PAGE, orgId ?? '', storeId ?? '');
  const warnPrefilled = usePrefilledWarning();
  const warnUnknownPrice = useUnknownPriceWarning(PAGE);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const items = React.useMemo(() => list.data ?? [], [list.data]);

  const openDetail = React.useCallback(
    (id: string) => router.push(`${DETAIL_BASE}/${id}`),
    [router],
  );

  const handleImport = React.useCallback(
    (input: WorkbookImportInput): void => {
      importList.mutate(input, {
        onSuccess: (result) => {
          setUploadOpen(false);
          warnPrefilled(result.prefilledRows);
          warnUnknownPrice(result);
          openDetail(result.id);
        },
      });
    },
    [importList, openDetail, warnPrefilled, warnUnknownPrice],
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
      <WorkbookUploadDialog
        page={PAGE}
        open={uploadOpen}
        onOpenChange={(next) => {
          if (!next) importList.reset();
          setUploadOpen(next);
        }}
        scope={{ orgId, storeId }}
        onSubmit={handleImport}
        submitting={importList.isPending}
        submitError={importList.error}
        onResetError={() => importList.reset()}
      />
    </>
  );
}
