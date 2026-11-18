'use client';

import { ArrowLeft01Icon, Delete02Icon, DownloadCircle01Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import { parseAsBoolean, parseAsString, useQueryStates } from 'nuqs';
import * as React from 'react';
import { toast } from 'sonner';

import { WORKBOOK_PAGES } from '@pazarsync/utils';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { EmptyState } from '@/components/patterns/empty-state';
import { PageHeader } from '@/components/patterns/page-header';
import { PageSkeleton } from '@/components/patterns/page-skeleton';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api-error';

import type { TargetMarginResult } from '../api/suggest-target-margin.api';
import { useDeleteMarketplaceCampaign } from '../hooks/use-delete-marketplace-campaign';
import { useExportWorkbook } from '../hooks/use-export-workbook';
import { useMarketplaceCampaignDetail } from '../hooks/use-marketplace-campaign-detail';
import { useResolvedCampaignAccess } from '../hooks/use-resolved-campaign-access';
import { useUpdateCampaignSelections } from '../hooks/use-update-campaign-selections';
import {
  adaptMarketplaceCampaignDetail,
  type MarketplaceCampaignRow,
} from '../lib/adapt-marketplace-campaign';
import { CampaignAccessProvider } from '../lib/campaign-access-context';
import { downloadBlob } from '../lib/download-blob';
import {
  applyCustomPrice,
  applyTargetMarginSuggestions,
  clearSelections,
  countCampaignChoices,
  filterCampaignRows,
  hasActiveCampaignFilters,
  hasCommissionTariffWarning,
  seedCampaignChoices,
  selectAllMax,
  selectProfitable,
  toCampaignSelectionsPayload,
  toggleCampaignChoice,
  type CampaignChoiceState,
  type CampaignFilterState,
  type CampaignPriceChoice,
  type CampaignTargetMarginMark,
} from '../lib/marketplace-campaign-selection';
import { TariffScopeProvider } from '../lib/tariff-scope';
import { CampaignReadOnlyNotice } from './campaign-read-only-notice';
import { MarketplaceCampaignConfigCard } from './marketplace-campaign-config-card';
import { MarketplaceCampaignConfigEditDialog } from './marketplace-campaign-config-edit-dialog';
import { MarketplaceCampaignItemsMobileCards } from './marketplace-campaign-items-mobile-cards';
import { MarketplaceCampaignItemsTable } from './marketplace-campaign-items-table';
import { MarketplaceCampaignSummary } from './marketplace-campaign-summary';
import { MarketplaceCampaignTargetMarginDialog } from './marketplace-campaign-target-margin-dialog';
import { MarketplaceCampaignToolbar } from './marketplace-campaign-toolbar';

const LIST_PATH = '/campaigns/marketplace-campaigns';

const EMPTY_CHOICES: CampaignChoiceState = { selection: {}, customPrices: {} };
const EMPTY_ROWS: readonly MarketplaceCampaignRow[] = [];

/**
 * Data-bound DETAIL screen for one saved Kampanyalar upload. Loads it from the backend (every
 * row's current, maximum-price and custom-price figures already computed), lets the seller edit
 * the campaign config (which recomputes every row), choose per product whether to join at the
 * maximum price or at their own price — one by one or with the smart-select actions — and
 * download the patched Trendyol file.
 *
 * The choices are a LOCAL buffer seeded once from the server: choosing an option, typing a price
 * or running a smart-select action never writes anything (the custom price's what-if and the
 * target-margin suggestions are read-only computes). Only "Kaydet ve İndir" writes — the whole
 * buffer in one selections request — and, on success, streams the export. The search and the
 * filter chips live in the URL (nuqs), so a reload or a shared link reproduces the view. No
 * client-side money math anywhere; the cards only render backend figures.
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
  const { mutate: exportCampaign, isPending: exporting } = useExportWorkbook(
    WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST,
    orgId ?? '',
    storeId ?? '',
  );
  const { mutate: deleteCampaign } = useDeleteMarketplaceCampaign(orgId ?? '', storeId ?? '');
  const access = useResolvedCampaignAccess(WORKBOOK_PAGES.MARKETPLACE_CAMPAIGN_LIST);

  const view = React.useMemo(
    () => (detail.data !== undefined ? adaptMarketplaceCampaignDetail(detail.data) : null),
    [detail.data],
  );

  // The buffer lives in ONE state object so every row handler below is an identity-stable
  // `useCallback([])` — a stable handler keeps the table's `columns` from rebuilding, which would
  // remount every cell and wipe a half-typed custom price.
  const [choices, setChoices] = React.useState<CampaignChoiceState>(EMPTY_CHOICES);
  const [seededId, setSeededId] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  // Counts every buffer change. A save clears `dirty` only when nothing changed while it was in
  // flight — an edit made during the request is not in the saved file and must stay guarded.
  const revisionRef = React.useRef(0);
  // Why the last target-margin run could not price a row — shown on the row's custom card.
  const [targetMarginMarks, setTargetMarginMarks] = React.useState<
    Record<string, CampaignTargetMarginMark>
  >({});
  const [editOpen, setEditOpen] = React.useState(false);
  const [targetMarginOpen, setTargetMarginOpen] = React.useState(false);

  // View state (search + chips) is URL-owned via nuqs: each chip drops from the URL at its default
  // (false) and q drops when empty, so a clean view leaves no query string. The buffer and the
  // dialogs stay LOCAL — transient edit state, not a shareable view.
  const [urlState, setUrlState] = useQueryStates(
    {
      q: parseAsString.withDefault(''),
      profitable: parseAsBoolean.withDefault(false),
      losing: parseAsBoolean.withDefault(false),
      selected: parseAsBoolean.withDefault(false),
      tariff: parseAsBoolean.withDefault(false),
    },
    { history: 'push' },
  );
  const filters = React.useMemo<CampaignFilterState>(
    () => ({
      query: urlState.q,
      profitable: urlState.profitable,
      losing: urlState.losing,
      selected: urlState.selected,
      tariffWarning: urlState.tariff,
    }),
    [urlState.q, urlState.profitable, urlState.losing, urlState.selected, urlState.tariff],
  );

  // Seed the buffer from the server's saved choices the first time this campaign's data arrives.
  // Adjusting state during render (guarded by the id, so once per campaign) is the React-
  // recommended alternative to a setState-in-effect. A refetch after a config edit or a save does
  // not re-seed, so the seller's buffered choices survive it.
  if (view !== null && view.header.id !== seededId) {
    setChoices(seedCampaignChoices(view.rows));
    setTargetMarginMarks({});
    setSeededId(view.header.id);
  }

  const rows = view?.rows ?? EMPTY_ROWS;
  const presentation = view?.header.scenarioPresentation ?? 'UNIT';
  // The "Seçililer" chip reads the buffer's selection, so the visible set follows every choice —
  // but only the selection: typing a custom price leaves it (and this memo) untouched.
  const filteredRows = React.useMemo(
    () => filterCampaignRows(rows, choices.selection, filters, presentation),
    [rows, choices.selection, filters, presentation],
  );
  const showTariffWarningFilter = React.useMemo(
    () => rows.some(hasCommissionTariffWarning),
    [rows],
  );

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

  const markChanged = React.useCallback((): void => {
    revisionRef.current += 1;
    setDirty(true);
  }, []);

  const handleToggleChoice = React.useCallback(
    (row: MarketplaceCampaignRow, choice: CampaignPriceChoice): void => {
      setChoices((prev) => toggleCampaignChoice(prev, row, choice));
      markChanged();
    },
    [markChanged],
  );

  const handleCustomPriceChange = React.useCallback(
    (row: MarketplaceCampaignRow, price: string | null): void => {
      setChoices((prev) => applyCustomPrice(prev, row, price));
      markChanged();
    },
    [markChanged],
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
    return <PageSkeleton label={tCommon('loading')} withBackLink statCells={2} framed />;
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

  const { header } = view;
  const counts = countCampaignChoices(rows, choices);
  const exportDisabled = counts.max + counts.custom === 0;
  // Both steps of "Kaydet ve İndir" (save → download) share one loading state.
  const savePending = savingSelections || exporting;
  const hasFilters = hasActiveCampaignFilters(filters);

  const applyFilters = (next: Partial<CampaignFilterState>): void => {
    const patch = {
      ...(next.query !== undefined ? { q: next.query } : {}),
      ...(next.profitable !== undefined ? { profitable: next.profitable } : {}),
      ...(next.losing !== undefined ? { losing: next.losing } : {}),
      ...(next.selected !== undefined ? { selected: next.selected } : {}),
      ...(next.tariffWarning !== undefined ? { tariff: next.tariffWarning } : {}),
    };
    // Per-keystroke search writes REPLACE (no letter-by-letter Back history); chip toggles PUSH.
    void setUrlState(patch, next.query !== undefined ? { history: 'replace' } : undefined);
  };
  const resetFilters = (): void =>
    void setUrlState({ q: '', profitable: false, losing: false, selected: false, tariff: false });

  // Every smart-select action works on the VISIBLE rows; hidden rows keep their choice.
  const applyBulk = (
    fn: (
      visible: readonly MarketplaceCampaignRow[],
      state: CampaignChoiceState,
    ) => CampaignChoiceState,
  ): void => {
    setChoices((prev) => fn(filteredRows, prev));
    markChanged();
  };

  const onClearSelections = (): void => {
    applyBulk(clearSelections);
    setTargetMarginMarks((prev) => {
      const next = { ...prev };
      for (const row of filteredRows) delete next[row.id];
      return next;
    });
  };

  // The target-margin suggestions land in the buffer like any other choice — nothing is saved.
  // A row the run could not price is marked; a re-run replaces the visible rows' marks.
  const onApplySuggestions = (suggestions: TargetMarginResult['suggestions']): void => {
    // The marks and the filled count depend only on the rows and the suggestions, never on the
    // buffer, so reading them here is safe; the buffer itself still updates functionally.
    const { marks, filled } = applyTargetMarginSuggestions(filteredRows, choices, suggestions);
    setChoices((prev) => applyTargetMarginSuggestions(filteredRows, prev, suggestions).state);
    setTargetMarginMarks((prev) => {
      const next = { ...prev };
      for (const row of filteredRows) delete next[row.id];
      return { ...next, ...marks };
    });
    markChanged();
    const unreachable = Object.values(marks).filter((mark) => mark === 'UNREACHABLE').length;
    const message = tPage('targetMargin.applied', { filled, unreachable });
    // A run that priced nothing is a warning, not a success.
    if (filled > 0) toast.success(message);
    else toast.warning(message);
  };

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

  const toolbar = (
    <MarketplaceCampaignToolbar
      filters={filters}
      onFiltersChange={applyFilters}
      showTariffWarningFilter={showTariffWarningFilter}
      onSelectAllMax={() => applyBulk(selectAllMax)}
      onSelectProfitable={() =>
        applyBulk((visible, state) => selectProfitable(visible, state, presentation))
      }
      onOpenTargetMargin={() => setTargetMarginOpen(true)}
      onClearSelections={onClearSelections}
      pending={savePending}
    />
  );

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
    <CampaignAccessProvider value={access}>
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
            // A member who cannot write gets neither delete nor save-and-download.
            actions={
              access.canWrite ? (
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
              ) : undefined
            }
            summary={
              <MarketplaceCampaignSummary
                itemCount={rows.length}
                maxCount={counts.max}
                customCount={counts.custom}
              />
            }
          />

          <CampaignReadOnlyNotice />

          <MarketplaceCampaignConfigCard header={header} onEdit={() => setEditOpen(true)} />

          <div className="hidden min-w-0 md:block">
            <MarketplaceCampaignItemsTable
              rows={filteredRows}
              presentation={presentation}
              selection={choices.selection}
              customPrices={choices.customPrices}
              targetMarginMarks={targetMarginMarks}
              onToggleChoice={handleToggleChoice}
              onCustomPriceChange={handleCustomPriceChange}
              toolbar={toolbar}
              hasActiveFilters={hasFilters}
              onClearFilters={resetFilters}
            />
          </div>
          <div className="gap-sm flex flex-col md:hidden">
            {toolbar}
            <MarketplaceCampaignItemsMobileCards
              rows={filteredRows}
              presentation={presentation}
              selection={choices.selection}
              customPrices={choices.customPrices}
              targetMarginMarks={targetMarginMarks}
              onToggleChoice={handleToggleChoice}
              onCustomPriceChange={handleCustomPriceChange}
              onClearFilters={resetFilters}
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

          {targetMarginOpen ? (
            <MarketplaceCampaignTargetMarginDialog
              open
              onOpenChange={(next) => {
                if (!next) setTargetMarginOpen(false);
              }}
              orgId={orgId}
              storeId={storeId}
              campaignId={campaignId}
              onApply={onApplySuggestions}
            />
          ) : null}
        </div>
      </TariffScopeProvider>
    </CampaignAccessProvider>
  );
}
