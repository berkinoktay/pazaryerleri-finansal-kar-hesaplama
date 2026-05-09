'use client';

import { Clock01Icon, UserIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/patterns/empty-state';
import { TimeAgo } from '@/components/patterns/time-ago';

import type { CostProfileVersion } from '../types/cost-profile.types';

import { CostProfileVersionDiff } from './cost-profile-version-diff';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CostProfileHistoryListProps {
  versions: CostProfileVersion[];
  isLoading: boolean;
}

// ─── Field label map ─────────────────────────────────────────────────────────
// Mapping changedField string keys to their i18n message keys (static so the
// template-literal TS error is avoided — next-intl's type checker rejects
// `t(\`fields.${dynamic}\`)` but accepts `t(SAFE_KEY)` when SAFE_KEY is a
// string literal union). `Record<string, string>` lookup keeps the fallback
// safe at runtime without forking the i18n copy.

const FIELD_LABEL_MAP: Record<string, string> = {
  name: 'Ad',
  type: 'Tür',
  amount: 'Tutar',
  currency: 'Para birimi',
  vatRate: 'KDV oranı',
  fxRateMode: 'Kur modu',
  manualFxRate: 'Manuel kur',
  note: 'Not',
  archivedAt: 'Arşivlendi',
} as const;

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
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Single version row ───────────────────────────────────────────────────────

interface VersionRowProps {
  version: CostProfileVersion;
  previousVersion: CostProfileVersion | null;
}

function VersionRow({ version, previousVersion }: VersionRowProps): React.ReactElement {
  const t = useTranslations('costs.detail.history');
  const [diffOpen, setDiffOpen] = React.useState(false);

  const isInitialCreate = version.version === 1;

  return (
    <>
      <div className="gap-sm flex items-start">
        {/* Timeline dot */}
        <div className="mt-1 flex shrink-0 flex-col items-center">
          <div className="bg-border size-2 rounded-full" />
        </div>

        <div className="gap-2xs flex min-w-0 flex-1 flex-col pb-4">
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

          {/* Changed-field chips */}
          {version.changedFields.length > 0 ? (
            <div className="gap-xs flex flex-wrap">
              {version.changedFields.map((field) => (
                <Badge key={field} tone="outline" size="sm">
                  {FIELD_LABEL_MAP[field] ?? field}
                </Badge>
              ))}
            </div>
          ) : null}

          {/* View diff button */}
          <Button
            variant="link"
            size="sm"
            className="h-auto self-start p-0 text-xs"
            onClick={() => setDiffOpen(true)}
          >
            {t('viewDiff')}
          </Button>
        </div>
      </div>

      <CostProfileVersionDiff
        open={diffOpen}
        onOpenChange={setDiffOpen}
        version={version}
        previousVersion={previousVersion}
      />
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Reverse-chronological timeline of cost profile version history.
 *
 * Each row shows: version badge, relative time (absolute on hover),
 * who made the change, changed-field chips, and a "Farkı gör" link
 * that opens the `CostProfileVersionDiff` sheet.
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

  // API returns newest-first; index i => previous is index i+1
  return (
    <div className="relative">
      {/* Vertical timeline line */}
      <div className="border-border absolute inset-y-1 left-1 w-px border-l border-dashed" />
      <div className="flex flex-col gap-0">
        {versions.map((version, index) => (
          <VersionRow
            key={version.id}
            version={version}
            previousVersion={versions[index + 1] ?? null}
          />
        ))}
      </div>
    </div>
  );
}
