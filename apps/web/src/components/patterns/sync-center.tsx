'use client';

import type { SyncStatus, SyncType } from '@pazarsync/db/enums';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  PackageIcon,
  RefreshIcon,
  Time04Icon,
} from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { MarketplaceLogo, type MarketplacePlatform } from '@/components/patterns/marketplace-logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMounted } from '@/lib/use-is-mounted';
import { cn } from '@/lib/utils';

/**
 * Generic SyncLog shape consumed by SyncCenter. Matches the API
 * response (and the Realtime event payload after camelCasing) so the
 * pattern doesn't need to import from a specific feature folder.
 *
 * `storeId` is optional for backwards-compat with the original
 * single-store callers — when omitted, every row collapses into one
 * unnamed group and SyncCenter renders identically to the v1.0 surface.
 */
export interface SyncCenterLog {
  id: string;
  storeId?: string;
  syncType: SyncType;
  /**
   * Worker-pipeline lifecycle. `PENDING` is briefly visible between
   * trigger and worker claim (~1s); `RUNNING` is active; `FAILED_RETRYABLE`
   * means the run hit a transient error (auth-OK, marketplace 5xx /
   * network blip) and is waiting in exponential backoff for the worker
   * to re-claim — surfaced as the third "Yeniden deneniyor" section.
   * `COMPLETED` / `FAILED` are terminal.
   */
  status: SyncStatus;
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  progressCurrent: number;
  progressTotal: number | null;
  errorCode: string | null;
  /** Error detail. Set on FAILED and FAILED_RETRYABLE rows. */
  errorMessage?: string | null;
  /** How many claim attempts have run. >0 once at least one has fired. */
  attemptCount?: number;
  /**
   * When the next retry will fire (for FAILED_RETRYABLE rows). Null on
   * any other status. Drives the "Yeniden denenecek HH:MM" countdown.
   */
  nextAttemptAt?: string | null;
  /**
   * Pages the worker skipped after exhausting MAX_ATTEMPTS on a
   * MARKETPLACE_UNREACHABLE error. Each entry: page index + diagnostic
   * surface. Drives the "X sayfa atlandı" warning chip on COMPLETED rows
   * (the merchant needs to know not the entire catalog made it across).
   */
  skippedPages?:
    | {
        page: number;
        attemptedAt: string;
        errorCode: string;
        httpStatus: number;
        xRequestId?: string;
        responseBodySnippet?: string;
      }[]
    | null;
}

export interface SyncCenterTriggerSpec {
  /** Sync type the button kicks off — used as the i18n key suffix too. */
  syncType: SyncCenterLog['syncType'];
  /** Click handler. The component shows a spinner while disabled. */
  onClick: () => void;
  /** True while a request is in flight; disables the button. */
  isPending: boolean;
}

/**
 * Lookup metadata for cross-store grouping. Pass the org's stores so
 * SyncCenter can label each group with its store name and marketplace
 * logo. Decoupled from the stores feature so the pattern stays
 * cross-feature; callers (which already have the stores in scope via
 * their dashboard layout / launcher context) feed it in.
 */
export interface SyncCenterStore {
  id: string;
  name: string;
  platform?: MarketplacePlatform;
}

export interface SyncCenterProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  logs: SyncCenterLog[];
  /** Per-type manual sync triggers — only PRODUCTS in v1.0. */
  triggers: SyncCenterTriggerSpec[];
  /**
   * Optional store metadata for cross-store grouping. When the visible
   * logs span more than one `storeId`, each store's rows are preceded
   * by a small header (name + marketplace logo). When all logs share a
   * single store (or omit `storeId` entirely — legacy callers), no
   * group chrome is rendered.
   */
  stores?: SyncCenterStore[];
}

/**
 * The SyncCenter Sheet — the user-facing surface for live sync progress
 * and recent sync history. Rendered as a right-side sheet so it doesn't
 * displace the main content. Three sections:
 *
 *   1. Active — every RUNNING sync with a progress bar
 *   2. Recent — last N completed/failed runs, newest first
 *   3. Triggers — "Şimdi senkronize et" buttons per sync type
 *
 * Cross-store grouping kicks in only when the visible logs span more
 * than one store; single-store callers see the v1.0 surface unchanged.
 *
 * Cross-feature (orders/settlements will reuse) so it lives in
 * components/patterns/ rather than features/products/components/.
 */
export function SyncCenter({
  open,
  onOpenChange,
  logs,
  triggers,
  stores,
}: SyncCenterProps): React.ReactElement {
  const t = useTranslations('syncCenter');

  // Three buckets: actively running (RUNNING/PENDING — worker either
  // claimed and processing, or queued and about to be claimed), retrying
  // (FAILED_RETRYABLE — hit a transient error and waiting for the next
  // attempt), and recent (terminal COMPLETED/FAILED, capped server-side).
  const active = logs.filter((log) => log.status === 'RUNNING' || log.status === 'PENDING');
  const retrying = logs.filter((log) => log.status === 'FAILED_RETRYABLE');
  const recent = logs.filter((log) => log.status === 'COMPLETED' || log.status === 'FAILED');

  // Group only when the visible logs reference 2+ distinct storeIds —
  // otherwise we'd add a single redundant header above the only group.
  const distinctStoreIds = new Set<string>();
  for (const log of logs) {
    if (log.storeId !== undefined) distinctStoreIds.add(log.storeId);
  }
  const showStoreGroups = distinctStoreIds.size >= 2;

  const storeLookup = new Map<string, SyncCenterStore>();
  for (const store of stores ?? []) storeLookup.set(store.id, store);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-lg max-w-sheet-wide flex flex-col">
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>

        <div className="gap-lg flex flex-col overflow-y-auto">
          {triggers.length > 0 ? (
            <section className="gap-sm flex flex-col">
              {triggers.map((trigger) => (
                <Button
                  key={trigger.syncType}
                  type="button"
                  onClick={trigger.onClick}
                  // Disable while ANY active-slot row exists for this
                  // syncType (active OR retrying — both occupy the
                  // partial unique index slot, so a manual retrigger
                  // would 409 with SYNC_IN_PROGRESS).
                  disabled={
                    trigger.isPending ||
                    active.some((l) => l.syncType === trigger.syncType) ||
                    retrying.some((l) => l.syncType === trigger.syncType)
                  }
                  className="gap-xs justify-start"
                >
                  <RefreshIcon
                    className={cn('size-icon-sm', trigger.isPending && 'animate-spin')}
                  />
                  {t(`triggers.${trigger.syncType}`)}
                </Button>
              ))}
            </section>
          ) : null}

          {active.length > 0 ? (
            <section className="gap-sm flex flex-col">
              <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
                {t('sections.active')}
              </h3>
              {showStoreGroups ? (
                <SyncLogsByStore
                  logs={active}
                  storeLookup={storeLookup}
                  renderRow={(log) => <ActiveSyncItem key={log.id} log={log} />}
                />
              ) : (
                active.map((log) => <ActiveSyncItem key={log.id} log={log} />)
              )}
            </section>
          ) : null}

          {active.length > 0 && retrying.length > 0 ? <Separator /> : null}

          {retrying.length > 0 ? (
            <section className="gap-sm flex flex-col">
              <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
                {t('sections.retrying')}
              </h3>
              {showStoreGroups ? (
                <SyncLogsByStore
                  logs={retrying}
                  storeLookup={storeLookup}
                  renderRow={(log) => <RetryingSyncItem key={log.id} log={log} />}
                />
              ) : (
                retrying.map((log) => <RetryingSyncItem key={log.id} log={log} />)
              )}
            </section>
          ) : null}

          {(active.length > 0 || retrying.length > 0) && recent.length > 0 ? <Separator /> : null}

          {recent.length > 0 ? (
            <section className="gap-sm flex flex-col">
              <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
                {t('sections.recent')}
              </h3>
              {showStoreGroups ? (
                <SyncLogsByStore
                  logs={recent}
                  storeLookup={storeLookup}
                  renderRow={(log) => <RecentSyncItem key={log.id} log={log} />}
                />
              ) : (
                recent.map((log) => <RecentSyncItem key={log.id} log={log} />)
              )}
            </section>
          ) : null}

          {logs.length === 0 ? (
            <p className="text-muted-foreground py-lg text-center text-sm">{t('empty')}</p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Groups sync logs by `storeId` and renders each group with a small
 * store header (marketplace logo + name) above its rows. Stable order:
 * groups appear in the order their first log appears in the input, so
 * the active section's "newest first" sort propagates through the
 * grouping unchanged.
 */
function SyncLogsByStore({
  logs,
  storeLookup,
  renderRow,
}: {
  logs: SyncCenterLog[];
  storeLookup: Map<string, SyncCenterStore>;
  renderRow: (log: SyncCenterLog) => React.ReactElement;
}): React.ReactElement {
  const groups = groupLogsByStore(logs);

  return (
    <>
      {groups.map((group) => {
        const store = group.storeId !== undefined ? storeLookup.get(group.storeId) : undefined;
        return (
          <div key={group.storeId ?? '__unknown__'} className="gap-xs flex flex-col">
            <StoreGroupHeader store={store} />
            {group.logs.map((log) => renderRow(log))}
          </div>
        );
      })}
    </>
  );
}

function StoreGroupHeader({ store }: { store: SyncCenterStore | undefined }): React.ReactElement {
  const t = useTranslations('syncCenter');
  const name = store?.name ?? t('unknownStore');
  return (
    <div className="gap-xs text-muted-foreground flex items-center text-xs font-medium">
      {store?.platform !== undefined ? (
        <MarketplaceLogo platform={store.platform} size="xs" alt="" />
      ) : null}
      <span className="truncate">{name}</span>
    </div>
  );
}

interface SyncLogStoreGroup {
  storeId: string | undefined;
  logs: SyncCenterLog[];
}

function groupLogsByStore(logs: SyncCenterLog[]): SyncLogStoreGroup[] {
  const groups: SyncLogStoreGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const log of logs) {
    const key = log.storeId ?? '__unknown__';
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({ storeId: log.storeId, logs: [log] });
    } else {
      groups[existing]?.logs.push(log);
    }
  }
  return groups;
}

function ActiveSyncItem({ log }: { log: SyncCenterLog }): React.ReactElement {
  const t = useTranslations('syncCenter');
  const formatter = useFormatter();
  const percent =
    log.progressTotal !== null && log.progressTotal > 0
      ? Math.min(100, Math.round((log.progressCurrent / log.progressTotal) * 100))
      : null;
  const statusKey = log.status === 'PENDING' ? 'status.pending' : 'status.running';

  return (
    <div className="border-border bg-card gap-xs flex flex-col rounded-md border p-3">
      <div className="gap-sm flex items-center">
        <Time04Icon className="size-icon-sm text-info animate-spin" />
        <span className="text-foreground text-sm font-medium">
          {t(`syncTypeLabel.${log.syncType}`)}
        </span>
        <Badge tone="info" size="sm" className="ml-auto">
          {t(statusKey)}
        </Badge>
      </div>
      <Progress value={percent ?? 0} />
      <p className="text-muted-foreground text-2xs tabular-nums">
        {formatter.number(log.progressCurrent, 'integer')}
        {log.progressTotal !== null ? ` / ${formatter.number(log.progressTotal, 'integer')}` : ''}
        {percent !== null ? ` (${percent.toString()}%)` : ''}
      </p>
    </div>
  );
}

function RetryingSyncItem({ log }: { log: SyncCenterLog }): React.ReactElement {
  const t = useTranslations('syncCenter');
  const formatter = useFormatter();
  const mounted = useIsMounted();
  const percent =
    log.progressTotal !== null && log.progressTotal > 0
      ? Math.min(100, Math.round((log.progressCurrent / log.progressTotal) * 100))
      : null;

  // SSR-safe retry-time label — same hydration pattern as SyncBadge /
  // RecentSyncItem. Until mounted, render an absolute timestamp; once
  // mounted, swap to a relative label that auto-updates.
  const retryLabel =
    log.nextAttemptAt !== null && log.nextAttemptAt !== undefined
      ? mounted
        ? formatter.relativeTime(new Date(log.nextAttemptAt), new Date())
        : formatter.dateTime(new Date(log.nextAttemptAt), 'short')
      : null;

  return (
    <div className="border-warning/40 bg-warning-surface gap-xs flex flex-col rounded-md border p-3">
      <div className="gap-sm flex items-center">
        <AlertCircleIcon className="size-icon-sm text-warning" />
        <span className="text-foreground text-sm font-medium">
          {t(`syncTypeLabel.${log.syncType}`)}
        </span>
        <Badge tone="warning" size="sm" className="ml-auto">
          {t('status.retrying')}
        </Badge>
      </div>
      <Progress value={percent ?? 0} />
      <p className="text-muted-foreground text-2xs tabular-nums">
        {formatter.number(log.progressCurrent, 'integer')}
        {log.progressTotal !== null ? ` / ${formatter.number(log.progressTotal, 'integer')}` : ''}
        {percent !== null ? ` (${percent.toString()}%)` : ''}
      </p>
      <div className="gap-3xs flex flex-col">
        {log.errorCode !== null ? (
          <p className="text-warning text-2xs">
            <span className="font-mono">{log.errorCode}</span>
            {log.errorMessage !== null && log.errorMessage !== undefined ? (
              <span className="text-muted-foreground"> · {log.errorMessage}</span>
            ) : null}
          </p>
        ) : null}
        <p className="text-muted-foreground text-2xs">
          {retryLabel !== null ? t('willRetry', { when: retryLabel }) : t('willRetryUnknown')}
          {log.attemptCount !== undefined && log.attemptCount > 0
            ? ` · ${t('attempt', { n: formatter.number(log.attemptCount, 'integer') })}`
            : ''}
        </p>
      </div>
    </div>
  );
}

function RecentSyncItem({ log }: { log: SyncCenterLog }): React.ReactElement {
  const t = useTranslations('syncCenter');
  const formatter = useFormatter();
  const mounted = useIsMounted();

  const skippedCount = log.skippedPages?.length ?? 0;
  const completedWithSkips = log.status === 'COMPLETED' && skippedCount > 0;

  // Completed sync that has skipped pages reads as a soft warning, not a
  // clean success — Trendyol gave us a partial catalog. Still uses the
  // warning surface (not destructive) because the work that did succeed
  // is durable; the user just needs to know some pages didn't.
  const Icon =
    log.status === 'FAILED'
      ? AlertCircleIcon
      : completedWithSkips
        ? AlertCircleIcon
        : CheckmarkCircle02Icon;
  const toneClass =
    log.status === 'FAILED'
      ? 'text-destructive'
      : completedWithSkips
        ? 'text-warning'
        : 'text-success';

  // SSR-safe time label — same pattern as SyncBadge.
  const reference = log.completedAt ?? log.startedAt;
  const timeLabel = mounted
    ? formatter.relativeTime(new Date(reference), new Date())
    : formatter.dateTime(new Date(reference), 'short');

  return (
    <div className="gap-sm flex items-start py-1">
      <Icon className={cn('size-icon-sm mt-0.5 shrink-0', toneClass)} />
      <div className="gap-3xs flex flex-1 flex-col">
        <div className="gap-xs flex flex-wrap items-baseline">
          <span className="text-foreground text-sm font-medium">
            {t(`syncTypeLabel.${log.syncType}`)}
          </span>
          <span className="text-muted-foreground text-2xs">{timeLabel}</span>
          {completedWithSkips ? (
            <Badge tone="warning" size="sm">
              {t('skippedChip', { n: formatter.number(skippedCount, 'integer') })}
            </Badge>
          ) : null}
        </div>
        {log.status === 'COMPLETED' && !completedWithSkips ? (
          <span className="text-muted-foreground text-2xs tabular-nums">
            {t('completedSummary', {
              n: formatter.number(log.recordsProcessed, 'integer'),
            })}
          </span>
        ) : completedWithSkips ? (
          <span className="text-warning text-2xs">
            {t('completedWithSkipsSummary', {
              n: formatter.number(log.recordsProcessed, 'integer'),
              skipped: formatter.number(skippedCount, 'integer'),
            })}
          </span>
        ) : log.errorCode !== null ? (
          <span className="text-destructive text-2xs">
            {t('failedSummary')}
            {' · '}
            <span className="font-mono">{log.errorCode}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export { PackageIcon };
