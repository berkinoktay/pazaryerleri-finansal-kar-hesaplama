'use client';

import { Clock01Icon, UserIcon, ArrowRight02Icon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/patterns/empty-state';
import { TimeAgo } from '@/components/patterns/time-ago';

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

// ─── Skeleton ────────────────────────────────────────────────────────────────

function HistorySkeleton(): React.ReactElement {
  return (
    <div className="gap-md flex flex-col" role="status" aria-label="Yükleniyor">
      {[0, 1, 2].map((i) => (
        <div key={i} className="gap-sm flex items-start">
          <Skeleton className="mt-1 size-8 rounded-full" />
          <div className="gap-xs flex flex-1 flex-col">
            <Skeleton className="h-4 w-32" />
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

/** v1 (initial create): single-column "İlk değer" row with green emphasis. */
function InitialFieldRow({ label, value }: InitialFieldProps): React.ReactElement {
  return (
    <div className="gap-xs flex items-baseline">
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

/**
 * v2+: before → after on a single line.
 * Before: red surface + strikethrough. After: green surface.
 * Wraps when long values force it. Mono font keeps numeric values aligned.
 */
function DiffRow({ label, before, after }: DiffRowProps): React.ReactElement {
  return (
    <div className="gap-xs flex items-baseline">
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
  const isInitialCreate = version.version === 1;

  return (
    <div className="gap-sm flex items-start">
      {/* Timeline dot + connecting line */}
      <div className="relative mt-1 flex shrink-0 flex-col items-center self-stretch">
        <div className="bg-primary ring-background size-2 rounded-full ring-2" />
        {!isLast ? <div className="border-border w-px flex-1 border-l border-dashed" /> : null}
      </div>

      <div className="gap-xs flex min-w-0 flex-1 flex-col pb-6">
        {/* Top row: version badge + time */}
        <div className="gap-sm flex flex-wrap items-center">
          <Badge tone="neutral" size="sm">
            {t('version', { version: version.version })}
          </Badge>
          {isInitialCreate ? (
            <span className="text-muted-foreground text-xs">{t('initialCreate')}</span>
          ) : null}
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

        {/* Inline diff */}
        {isInitialCreate ? (
          <div className="gap-2xs mt-xs flex flex-col">
            {DIFF_FIELDS.filter((f) => {
              const v = version[f as keyof CostProfileVersion];
              return v !== null && v !== undefined;
            }).map((field) => (
              <InitialFieldRow
                key={field}
                label={FIELD_LABEL[field]}
                value={formatValue(version, field)}
              />
            ))}
          </div>
        ) : (
          <div className="gap-2xs mt-xs flex flex-col">
            {version.changedFields.filter(isDiffField).map((field) => (
              <DiffRow
                key={field}
                label={FIELD_LABEL[field]}
                before={previousVersion !== null ? formatValue(previousVersion, field) : '—'}
                after={formatValue(version, field)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Reverse-chronological timeline of cost profile version history with
 * inline diffs. Every changed field renders as `before → after` with
 * red strikethrough on the old value and green surface on the new one.
 * No collapsed / "view diff" affordance — the change is visible at a
 * glance, which is the point.
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
