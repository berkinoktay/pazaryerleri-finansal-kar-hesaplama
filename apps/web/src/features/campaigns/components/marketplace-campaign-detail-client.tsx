'use client';

import { ArrowLeft01Icon, Delete02Icon, DownloadCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api-error';

import { useDeleteMarketplaceCampaign } from '../hooks/use-delete-marketplace-campaign';
import { useExportMarketplaceCampaign } from '../hooks/use-export-marketplace-campaign';
import { useMarketplaceCampaignDetail } from '../hooks/use-marketplace-campaign-detail';
import { useUpdateCampaignSelections } from '../hooks/use-update-campaign-selections';
import {
  adaptMarketplaceCampaignDetail,
  type MarketplaceCampaignRow,
} from '../lib/adapt-marketplace-campaign';
import { downloadBlob } from '../lib/download-blob';
import {
  applyCustomPrice,
  joinedCampaignCount,
  seedCampaignChoices,
  toCampaignSelectionsPayload,
  toggleCampaignChoice,
  type CampaignChoiceState,
  type CampaignPriceChoice,
} from '../lib/marketplace-campaign-selection';
import { TariffScopeProvider } from '../lib/tariff-scope';
import { MarketplaceCampaignConfigCard } from './marketplace-campaign-config-card';
import { MarketplaceCampaignConfigEditDialog } from './marketplace-campaign-config-edit-dialog';
import { MarketplaceCampaignItemsMobileCards } from './marketplace-campaign-items-mobile-cards';
import { MarketplaceCampaignItemsTable } from './marketplace-campaign-items-table';

const LIST_PATH = '/campaigns/marketplace-campaigns';

const EMPTY_CHOICES: CampaignChoiceState = { selection: {}, customPrices: {} };

/**
 * Data-bound DETAIL screen for one saved Kampanyalar upload. Loads it from the backend (every
 * row's current, maximum-price and custom-price figures already computed), lets the seller edit
 * the campaign config (which recomputes every row), choose per product whether to join at the
 * maximum price or at their own price, and download the patched Trendyol file.
 *
 * The choices are a LOCAL buffer seeded once from the server: choosing an option or typing a
 * price never touches the network (the custom price's what-if estimate aside — one shared query
 * per price, see `useCustomPriceWhatIf`). Only "Kaydet ve İndir" writes — the whole buffer in one
 * selections request — and, on success, streams the export. No client-side money math anywhere;
 * the cards only render backend figures.
 */
export function MarketplaceCampaignDetailClient({
  orgId,
  storeId,
  campaignId,
}: {
  orgId: string | null;
  storeId: string | null;
  campaignId: string;
}): React.ReactElement {
  const tPage = useTranslations('marketplaceCampaignsPage');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const detail = useMarketplaceCampaignDetail(orgId ?? '', storeId, campaignId);
  const { mutate: saveSelections, isPending: savingSelections } = useUpdateCampaignSelections(
    orgId ?? '',
    storeId ?? '',
    campaignId,
  );
  const { mutate: exportCampaign, isPending: exporting } = useExportMarketplaceCampaign(
    orgId ?? '',
    storeId ?? '',
  );
  const { mutate: deleteCampaign } = useDeleteMarketplaceCampaign(orgId ?? '', storeId ?? '');

  const view = React.useMemo(
    () => (detail.data !== undefined ? adaptMarketplaceCampaignDetail(detail.data) : null),
    [detail.data],
  );

  // The buffer lives in ONE state object so every handler below is an identity-stable
  // `useCallback([])` — a stable handler keeps the table's `columns` from rebuilding, which
  // would remount every cell and wipe a half-typed custom price.
  const [choices, setChoices] = React.useState<CampaignChoiceState>(EMPTY_CHOICES);
  const [seededId, setSeededId] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  // Counts every buffer change. A save clears `dirty` only when nothing changed while it was in
  // flight — an edit made during the request is not in the saved file and must stay guarded.
  const revisionRef = React.useRef(0);
  const [editOpen, setEditOpen] = React.useState(false);

  // Seed the buffer from the server's saved choices the first time this campaign's data arrives.
  // Adjusting state during render (guarded by the id, so once per campaign) is the React-
  // recommended alternative to a setState-in-effect. A refetch after a config edit or a save does
  // not re-seed, so the seller's buffered choices survive it.
  if (view !== null && view.header.id !== seededId) {
    setChoices(seedCampaignChoices(view.rows));
    setSeededId(view.header.id);
  }

  // Guard unsaved choices against an ACCIDENTAL unload (refresh / tab close). Syncing with the
  // window is exactly what an effect is for; it re-subscribes only when `dirty` flips. Browsers
  // show their own wording — a custom message is impossible.
  React.useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Legacy Chrome/Edge still require returnValue to be set for the prompt to appear.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const handleToggleChoice = React.useCallback(
    (row: MarketplaceCampaignRow, choice: CampaignPriceChoice): void => {
      setChoices((prev) => toggleCampaignChoice(prev, row, choice));
      revisionRef.current += 1;
      setDirty(true);
    },
    [],
  );

  const handleCustomPriceChange = React.useCallback(
    (row: MarketplaceCampaignRow, price: string | null): void => {
      setChoices((prev) => applyCustomPrice(prev, row, price));
      revisionRef.current += 1;
      setDirty(true);
    },
    [],
  );

  // No store selected: the detail query is disabled and every action needs a store, so show a
  // store-selection state instead of a misleading "not found".
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

  if (detail.isLoading) {
    return <PageSkeleton label={tCommon('loading')} withBackLink framed />;
  }

  // A genuine 404 (deleted / cross-tenant — the non-disclosure convention says "not found") is
  // told apart from a transient failure (offer a retry). The global onError already toasts.
  if (detail.isError) {
    const notFound = detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND';
    return (
      <EmptyState
        title={notFound ? tPage('templates.notFoundTitle') : tCommon('stat.loadError')}
        description={notFound ? tPage('templates.notFoundDescription') : undefined}
        action={
          notFound ? (
            <Button variant="outline" size="sm" onClick={() => router.push(LIST_PATH)}>
              {tPage('templates.back')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void detail.refetch()}>
              {tCommon('stat.retry')}
            </Button>
          )
        }
      />
    );
  }

  if (view === null) {
    return (
      <EmptyState
        title={tPage('templates.notFoundTitle')}
        description={tPage('templates.notFoundDescription')}
        action={
          <Button variant="outline" size="sm" onClick={() => router.push(LIST_PATH)}>
            {tPage('templates.back')}
          </Button>
        }
      />
    );
  }

  const { header, rows } = view;
  const joinedCount = joinedCampaignCount(rows, choices);
  const exportDisabled = joinedCount === 0;
  // Both steps of "Kaydet ve İndir" (save → download) share one loading state.
  const savePending = savingSelections || exporting;

  // Writes the WHOLE buffer (mode 'set' over every row, so the saved state mirrors it exactly),
  // then — only on success — streams the export. A save failure aborts before the download; the
  // global error pipeline already toasts.
  const onSaveAndDownload = (): void => {
    const savedRevision = revisionRef.current;
    saveSelections(
      { mode: 'set', selections: toCampaignSelectionsPayload(rows, choices) },
      {
        onSuccess: () => {
          if (revisionRef.current === savedRevision) setDirty(false);
          exportCampaign(campaignId, {
            // Filename comes from the server; fall back to the campaign name if it was absent.
            onSuccess: (file) => downloadBlob(file.blob, file.filename ?? `${header.name}.xlsx`),
          });
        },
      },
    );
  };

  const exportButton = (
    <Button
      size="sm"
      onClick={onSaveAndDownload}
      disabled={exportDisabled}
      loading={savePending}
      leadingIcon={<DownloadCircle01Icon aria-hidden />}
    >
      {tPage('actions.saveAndDownload')}
    </Button>
  );

  return (
    <TariffScopeProvider scope={{ orgId, storeId, tariffId: campaignId }}>
      <div className="gap-lg flex flex-col">
        <PageHeader
          leading={
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(LIST_PATH)}
              leadingIcon={<ArrowLeft01Icon aria-hidden />}
            >
              {tPage('templates.back')}
            </Button>
          }
          title={header.name}
          intent={tPage('templates.detailIntent')}
          variant="framed"
          actions={
            <div className="gap-sm flex items-center">
              <ConfirmDialog
                trigger={
                  <Button
                    variant="destructive-ghost"
                    size="sm"
                    leadingIcon={<Delete02Icon aria-hidden />}
                  >
                    {tPage('templates.delete')}
                  </Button>
                }
                title={tPage('templates.deleteTitle')}
                description={tPage('templates.deleteDescription')}
                confirmLabel={tPage('templates.deleteConfirm')}
                onConfirm={() =>
                  deleteCampaign(campaignId, { onSuccess: () => router.push(LIST_PATH) })
                }
              />
              {/* Export needs at least one participating product; a disabled button can't emit
                  hover, so the tooltip wraps a focusable span that explains why. */}
              {exportDisabled ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>{exportButton}</span>
                  </TooltipTrigger>
                  <TooltipContent>{tPage('actions.exportEmptyHint')}</TooltipContent>
                </Tooltip>
              ) : (
                exportButton
              )}
            </div>
          }
        />

        <MarketplaceCampaignConfigCard header={header} onEdit={() => setEditOpen(true)} />

        <div className="hidden min-w-0 md:block">
          <MarketplaceCampaignItemsTable
            rows={rows}
            presentation={header.scenarioPresentation}
            selection={choices.selection}
            customPrices={choices.customPrices}
            onToggleChoice={handleToggleChoice}
            onCustomPriceChange={handleCustomPriceChange}
          />
        </div>
        <div className="md:hidden">
          <MarketplaceCampaignItemsMobileCards
            rows={rows}
            presentation={header.scenarioPresentation}
            selection={choices.selection}
            customPrices={choices.customPrices}
            onToggleChoice={handleToggleChoice}
            onCustomPriceChange={handleCustomPriceChange}
          />
        </div>

        {editOpen ? (
          <MarketplaceCampaignConfigEditDialog
            open
            onOpenChange={(next) => {
              if (!next) setEditOpen(false);
            }}
            orgId={orgId}
            storeId={storeId}
            campaignId={campaignId}
            header={header}
          />
        ) : null}
      </div>
    </TariffScopeProvider>
  );
}
