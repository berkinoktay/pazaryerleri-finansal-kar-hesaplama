'use client';

import {
  Archive01Icon,
  ArrowReloadVerticalIcon,
  ArrowRight02Icon,
  Clock01Icon,
  Edit01Icon,
  PlusSignSquareIcon,
  UserIcon,
} from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { EmptyState } from '@/components/patterns/empty-state';
import { TimeAgo } from '@/components/patterns/time-ago';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import type { CostProfileVersion } from '../types/cost-profile.types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CostProfileHistoryListProps {
  versions: CostProfileVersion[];
  isLoading: boolean;
}

// Versioned fields we can render in a diff. Aligned with the backend's
// TRACKED list in cost-profile.service.ts.
const DIFF_FIELDS = [
  'name',
  'type',
  'amount',
  'currency',
  'vatRate',
  'fxRateMode',
  'manualFxRate',
  'note',
  'archivedAt',
] as const;

type DiffField = (typeof DIFF_FIELDS)[number];

const FIELD_LABEL: Record<DiffField, string> = {
  name: 'Ad',
  type: 'Tür',
  amount: 'Tutar',
  currency: 'Para birimi',
  vatRate: 'KDV oranı',
  fxRateMode: 'Kur modu',
  manualFxRate: 'Manuel kur',
  note: 'Not',
  archivedAt: 'Arşivlendi',
};

function isDiffField(key: string): key is DiffField {
  return (DIFF_FIELDS as readonly string[]).includes(key);
}

function formatValue(version: CostProfileVersion, field: DiffField): string {
  const raw = version[field as keyof CostProfileVersion];
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return String(raw);
}

// ─── Event classification ────────────────────────────────────────────────────
// Each version is one of four event types — chosen so the seller reads
// "what happened" instead of "which version number". Order matters:
//   1. version 1                       → CREATED (initial create)
//   2. only archivedAt changed, → ts   → ARCHIVED
//   3. only archivedAt changed, → null → RESTORED
//   4. anything else                   → UPDATED

type HistoryEvent = 'created' | 'archived' | 'restored' | 'updated';

function classifyEvent(version: CostProfileVersion): HistoryEvent {
  if (version.version === 1) return 'created';
  const fields = version.changedFields;
  if (fields.length === 1 && fields[0] === 'archivedAt') {
    return version.archivedAt !== null ? 'archived' : 'restored';
  }
  return 'updated';
}

const EVENT_ICON: Record<HistoryEvent, React.ComponentType<{ className?: string }>> = {
  created: PlusSignSquareIcon,
  updated: Edit01Icon,
  archived: Archive01Icon,
  restored: ArrowReloadVerticalIcon,
};

const EVENT_DOT_CLASS: Record<HistoryEvent, string> = {
  created: 'bg-success text-success-foreground',
  updated: 'bg-primary text-primary-foreground',
  archived: 'bg-warning text-warning-foreground',
  restored: 'bg-info text-info-foreground',
};

// ─── Skeleton ────────────────────────────────────────────────────────────────

function HistorySkeleton(): React.ReactElement {
  return (
    <div className="gap-md flex flex-col" role="status" aria-label="Yükleniyor">
      {[0, 1, 2].map((i) => (
        <div key={i} className="gap-sm flex items-start">
          <Skeleton className="mt-1 size-7 rounded-full" />
          <div className="gap-xs flex flex-1 flex-col">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Diff rows (the visual core of this redesign) ─────────────────────────────

interface InitialFieldProps {
  label: string;
  value: string;
}

function InitialFieldRow({ label, value }: InitialFieldProps): React.ReactElement {
  return (
    <div className="gap-sm flex items-baseline">
      <span className="text-muted-foreground w-28 shrink-0 text-xs">{label}</span>
      <span className="bg-success-surface text-success rounded-sm px-1.5 py-0.5 font-mono text-xs">
        {value}
      </span>
    </div>
  );
}

interface DiffRowProps {
  label: string;
  before: string;
  after: string;
}

function DiffRow({ label, before, after }: DiffRowProps): React.ReactElement {
  return (
    <div className="gap-sm flex items-baseline">
      <span className="text-muted-foreground w-28 shrink-0 text-xs">{label}</span>
      <div className="gap-xs flex min-w-0 flex-wrap items-baseline">
        <span className="bg-destructive-surface text-destructive rounded-sm px-1.5 py-0.5 font-mono text-xs line-through decoration-from-font">
          {before}
        </span>
        <ArrowRight02Icon className="text-muted-foreground/60 size-icon-xs shrink-0" />
        <span className="bg-success-surface text-success rounded-sm px-1.5 py-0.5 font-mono text-xs">
          {after}
        </span>
      </div>
    </div>
  );
}

// ─── Single version row ───────────────────────────────────────────────────────

interface VersionRowProps {
  version: CostProfileVersion;
  previousVersion: CostProfileVersion | null;
  isLast: boolean;
}

function VersionRow({ version, previousVersion, isLast }: VersionRowProps): React.ReactElement {
  const t = useTranslations('costs.detail.history');
  const event = classifyEvent(version);
  const Icon = EVENT_ICON[event];
  const isInitialCreate = event === 'created';
  const isStateChange = event === 'archived' || event === 'restored';
  // Filter changedFields → only fields we know how to render. Anything else
  // (e.g. archivedAt on a state-change event we're already conveying via
  // the event label) is suppressed to avoid duplicate / awkward rows.
  const renderedDiffFields = isInitialCreate
    ? null
    : isStateChange
      ? []
      : version.changedFields.filter(isDiffField).filter((f) => f !== 'archivedAt');

  return (
    <div className="gap-sm flex items-start">
      {/* Timeline icon dot + connecting line */}
      <div className="relative mt-0.5 flex shrink-0 flex-col items-center self-stretch">
        <div
          className={cn(
            'ring-background flex size-7 items-center justify-center rounded-full ring-4',
            EVENT_DOT_CLASS[event],
          )}
        >
          <Icon className="size-icon-xs" />
        </div>
        {!isLast ? <div className="border-border mt-1 w-px flex-1 border-l border-dashed" /> : null}
      </div>

      <div className="gap-xs flex min-w-0 flex-1 flex-col pb-6">
        {/* Top row: event label + time */}
        <div className="gap-xs flex flex-wrap items-baseline">
          <span className="text-foreground text-sm font-medium">{t(`event.${event}`)}</span>
          <span className="text-muted-foreground/60 text-xs">·</span>
          <TimeAgo value={version.changedAt} className="text-muted-foreground text-xs" />
        </div>

        {/* Changed-by */}
        <div className="gap-xs text-muted-foreground flex items-center text-xs">
          <UserIcon className="size-icon-xs" />
          <span>
            {version.changedBy !== null
              ? t('changedBy', { userId: version.changedBy })
              : t('system')}
          </span>
        </div>

        {/* Diff body */}
        {isInitialCreate ? (
          <div className="gap-2xs mt-xs flex flex-col">
            {DIFF_FIELDS.filter((f) => f !== 'archivedAt').map((field) => {
              const v = version[field as keyof CostProfileVersion];
              if (v === null || v === undefined) return null;
              return (
                <InitialFieldRow
                  key={field}
                  label={FIELD_LABEL[field]}
                  value={formatValue(version, field)}
                />
              );
            })}
          </div>
        ) : renderedDiffFields !== null && renderedDiffFields.length > 0 ? (
          <div className="gap-2xs mt-xs flex flex-col">
            {renderedDiffFields.map((field) => (
              <DiffRow
                key={field}
                label={FIELD_LABEL[field]}
                before={previousVersion !== null ? formatValue(previousVersion, field) : '—'}
                after={formatValue(version, field)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Reverse-chronological timeline of cost profile version history with
 * inline diffs. Each entry is classified into a semantic event
 * (created / updated / archived / restored) so the seller reads the
 * timeline as a sequence of actions rather than version numbers.
 *
 * @useWhen displaying the audit history of a cost profile in the Geçmiş tab
 */
export function CostProfileHistoryList({
  versions,
  isLoading,
}: CostProfileHistoryListProps): React.ReactElement {
  const t = useTranslations('costs.detail.history');

  if (isLoading) {
    return <HistorySkeleton />;
  }

  if (versions.length === 0) {
    return (
      <EmptyState
        icon={Clock01Icon}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  // API returns newest-first; index i → previous is index i+1
  return (
    <div className="flex flex-col gap-0">
      {versions.map((version, index) => (
        <VersionRow
          key={version.id}
          version={version}
          previousVersion={versions[index + 1] ?? null}
          isLast={index === versions.length - 1}
        />
      ))}
    </div>
  );
}
