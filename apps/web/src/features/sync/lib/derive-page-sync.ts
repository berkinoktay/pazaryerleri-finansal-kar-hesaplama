import type { SyncStatus, SyncType } from '@pazarsync/db/enums';

import type { PageSyncKey, PageSyncSpec } from '../config/page-sync-sources';
import { PAGE_SYNC_SOURCES } from '../config/page-sync-sources';

export type PageSyncState = 'fresh' | 'stale' | 'failed' | 'syncing' | 'retrying';

export interface PageSyncFreshnessEntry {
  storeId: string;
  syncType: SyncType;
  completedAt: string; // ISO
  recordsProcessed: number;
}

/** SyncLog'un bu modülün ihtiyaç duyduğu yapısal alt kümesi (api-client'a bağımlılık yok). */
export interface PageSyncLogRow {
  storeId: string;
  syncType: SyncType;
  status: SyncStatus;
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  progressCurrent: number;
  progressTotal: number | null;
  nextAttemptAt?: string | null;
  errorCode: string | null;
}

export interface PageSyncSourceRow {
  syncType: SyncType;
  state: PageSyncState;
  lastSyncedAt: string | null; // freshness'tan
  recordsProcessed: number | null; // freshness'tan
  progress: { current: number; total: number | null } | null; // yalnız aktifken
  nextAttemptAt: string | null; // yalnız retrying'de
  errorCode: string | null; // failed/retrying'de
}

export interface PageSyncOtherFlow {
  storeId: string;
  syncType: SyncType;
  status: SyncStatus; // RUNNING/PENDING/FAILED_RETRYABLE/FAILED
  progress: { current: number; total: number | null } | null;
  nextAttemptAt: string | null;
}

export interface PageSyncViewModel {
  control: {
    state: PageSyncState;
    lastSyncedAt: string | null;
    progress: { current: number; total: number | null } | null;
    nextAttemptAt: string | null;
  };
  sources: PageSyncSourceRow[];
  others: PageSyncOtherFlow[];
}

const MS_PER_HOUR = 60 * 60 * 1000;

type SyncProgress = { current: number; total: number | null };

/** State + supporting details for one sync type, scoped to a single store. */
interface TypeDerivation {
  state: PageSyncState;
  progress: SyncProgress | null;
  nextAttemptAt: string | null;
  errorCode: string | null;
  lastSyncedAt: string | null;
  recordsProcessed: number | null;
}

function isStale(completedAt: string, now: Date, staleAfterHours: number): boolean {
  const ageMs = now.getTime() - Date.parse(completedAt);
  return ageMs > staleAfterHours * MS_PER_HOUR;
}

function newestIso(times: readonly string[]): string {
  return times.reduce((acc, time) => (Date.parse(time) > Date.parse(acc) ? time : acc));
}

function byStartedAtDesc(a: PageSyncLogRow, b: PageSyncLogRow): number {
  return Date.parse(b.startedAt) - Date.parse(a.startedAt);
}

/**
 * Resolve one sync type's state for the page's store. Precedence:
 * active row (syncing/retrying) → most-recent recent row is FAILED (failed) →
 * freshness older than the window (stale) → fresh. lastSyncedAt/recordsProcessed
 * always come from freshness so the last success stays visible even mid-run.
 */
function deriveTypeState(
  syncType: SyncType,
  storeId: string,
  activeSyncs: readonly PageSyncLogRow[],
  recentSyncs: readonly PageSyncLogRow[],
  freshness: readonly PageSyncFreshnessEntry[],
  staleAfterHours: number,
  now: Date,
): TypeDerivation {
  const success = freshness.find((f) => f.storeId === storeId && f.syncType === syncType);
  const lastSyncedAt = success?.completedAt ?? null;
  const recordsProcessed = success?.recordsProcessed ?? null;

  const active = activeSyncs.find((r) => r.storeId === storeId && r.syncType === syncType);
  if (active !== undefined) {
    if (active.status === 'FAILED_RETRYABLE') {
      return {
        state: 'retrying',
        progress: null,
        nextAttemptAt: active.nextAttemptAt ?? null,
        errorCode: active.errorCode,
        lastSyncedAt,
        recordsProcessed,
      };
    }
    return {
      state: 'syncing',
      progress: { current: active.progressCurrent, total: active.progressTotal },
      nextAttemptAt: null,
      errorCode: null,
      lastSyncedAt,
      recordsProcessed,
    };
  }

  const recent = recentSyncs.find((r) => r.storeId === storeId && r.syncType === syncType);
  if (recent !== undefined && recent.status === 'FAILED') {
    return {
      state: 'failed',
      progress: null,
      nextAttemptAt: null,
      errorCode: recent.errorCode,
      lastSyncedAt,
      recordsProcessed,
    };
  }

  if (lastSyncedAt !== null && isStale(lastSyncedAt, now, staleAfterHours)) {
    return {
      state: 'stale',
      progress: null,
      nextAttemptAt: null,
      errorCode: null,
      lastSyncedAt,
      recordsProcessed,
    };
  }

  return {
    state: 'fresh',
    progress: null,
    nextAttemptAt: null,
    errorCode: null,
    lastSyncedAt,
    recordsProcessed,
  };
}

function toSourceRow(syncType: SyncType, derivation: TypeDerivation): PageSyncSourceRow {
  return {
    syncType,
    state: derivation.state,
    lastSyncedAt: derivation.lastSyncedAt,
    recordsProcessed: derivation.recordsProcessed,
    progress: derivation.progress,
    nextAttemptAt: derivation.nextAttemptAt,
    errorCode: derivation.errorCode,
  };
}

function toOtherFlow(row: PageSyncLogRow): PageSyncOtherFlow {
  if (row.status === 'RUNNING' || row.status === 'PENDING') {
    return {
      storeId: row.storeId,
      syncType: row.syncType,
      status: row.status,
      progress: { current: row.progressCurrent, total: row.progressTotal },
      nextAttemptAt: null,
    };
  }
  if (row.status === 'FAILED_RETRYABLE') {
    return {
      storeId: row.storeId,
      syncType: row.syncType,
      status: row.status,
      progress: null,
      nextAttemptAt: row.nextAttemptAt ?? null,
    };
  }
  return {
    storeId: row.storeId,
    syncType: row.syncType,
    status: row.status,
    progress: null,
    nextAttemptAt: null,
  };
}

/**
 * Project the org-wide sync buckets into a single page's freshness view model:
 * a control (newest success across the page's sources for the timestamp, the
 * worst-of state across the same set, progress from the active source), the
 * per-source rows the popover lists, and the "rest of the panel" flows running
 * or failing elsewhere.
 */
export function derivePageSync(input: {
  pageKey: PageSyncKey;
  storeId: string;
  activeSyncs: readonly PageSyncLogRow[]; // org-geneli (PENDING/RUNNING/FAILED_RETRYABLE)
  recentSyncs: readonly PageSyncLogRow[]; // org-geneli (COMPLETED/FAILED, en yeni önce)
  freshness: readonly PageSyncFreshnessEntry[]; // org-geneli tip başına son başarı
  now: Date;
}): PageSyncViewModel {
  const { pageKey, storeId, activeSyncs, recentSyncs, freshness, now } = input;
  const spec = PAGE_SYNC_SOURCES[pageKey];

  const sourceTypes: readonly SyncType[] = [...spec.primary, ...spec.secondary];
  const sources = sourceTypes.map((syncType) =>
    toSourceRow(
      syncType,
      deriveTypeState(
        syncType,
        storeId,
        activeSyncs,
        recentSyncs,
        freshness,
        spec.staleAfterHours,
        now,
      ),
    ),
  );

  const control = deriveControl(sources);
  const others = deriveOthers(spec, storeId, activeSyncs, recentSyncs);

  return { control, sources, others };
}

/**
 * Collapse the page's source rows into the single control. Every source counts
 * equally now (no primary/secondary split):
 *   - timestamp = the NEWEST last-success across all sources
 *   - state priority: any syncing → syncing (progress from the first active
 *     source with a known total, else the first active) → any retrying →
 *     any failed → any stale → fresh
 */
function deriveControl(sources: readonly PageSyncSourceRow[]): PageSyncViewModel['control'] {
  const times = sources
    .map((source) => source.lastSyncedAt)
    .filter((time): time is string => time !== null);
  const lastSyncedAt = times.length > 0 ? newestIso(times) : null;

  const firstSyncing = sources.find((source) => source.state === 'syncing');
  if (firstSyncing !== undefined) {
    const syncingWithTotal = sources.find(
      (source) => source.state === 'syncing' && source.progress?.total != null,
    );
    const chosen = syncingWithTotal ?? firstSyncing;
    return { state: 'syncing', lastSyncedAt, progress: chosen.progress, nextAttemptAt: null };
  }

  const retrying = sources.find((source) => source.state === 'retrying');
  if (retrying !== undefined) {
    return {
      state: 'retrying',
      lastSyncedAt,
      progress: null,
      nextAttemptAt: retrying.nextAttemptAt,
    };
  }

  if (sources.some((source) => source.state === 'failed')) {
    return { state: 'failed', lastSyncedAt, progress: null, nextAttemptAt: null };
  }

  if (sources.some((source) => source.state === 'stale')) {
    return { state: 'stale', lastSyncedAt, progress: null, nextAttemptAt: null };
  }

  return { state: 'fresh', lastSyncedAt, progress: null, nextAttemptAt: null };
}

function deriveOthers(
  spec: PageSyncSpec,
  storeId: string,
  activeSyncs: readonly PageSyncLogRow[],
  recentSyncs: readonly PageSyncLogRow[],
): PageSyncOtherFlow[] {
  const pageTypes = new Set<SyncType>([...spec.primary, ...spec.secondary]);
  const belongsToPage = (row: PageSyncLogRow): boolean =>
    row.storeId === storeId && pageTypes.has(row.syncType);

  const otherActive = activeSyncs.filter((row) => !belongsToPage(row)).sort(byStartedAtDesc);
  const otherFailed = recentSyncs
    .filter((row) => row.status === 'FAILED' && !belongsToPage(row))
    .sort(byStartedAtDesc);

  return [...otherActive, ...otherFailed].map(toOtherFlow);
}
