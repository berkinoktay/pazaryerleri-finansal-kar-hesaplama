'use client';

import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  PackageIcon,
  RefreshIcon,
  Time04Icon,
} from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

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
 */
export interface SyncCenterLog {
  id: string;
  syncType: 'PRODUCTS' | 'ORDERS' | 'SETTLEMENTS';
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  progressCurrent: number;
  progressTotal: number | null;
  errorCode: string | null;
}

export interface SyncCenterTriggerSpec {
  /** Sync type the button kicks off — used as the i18n key suffix too. */
  syncType: SyncCenterLog['syncType'];
  /** Click handler. The component shows a spinner while disabled. */
  onClick: () => void;
  /** True while a request is in flight; disables the button. */
  isPending: boolean;
}

export interface SyncCenterProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  logs: SyncCenterLog[];
  /** Per-type manual sync triggers — only PRODUCTS in v1.0. */
  triggers: SyncCenterTriggerSpec[];
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
 * Cross-feature (orders/settlements will reuse) so it lives in
 * components/patterns/ rather than features/products/components/.
 */
export function SyncCenter({
  open,
  onOpenChange,
  logs,
  triggers,
}: SyncCenterProps): React.ReactElement {
  const t = useTranslations('syncCenter');

  const active = logs.filter((log) => log.status === 'RUNNING');
  const recent = logs.filter((log) => log.status !== 'RUNNING');

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
                  disabled={
                    trigger.isPending || active.some((l) => l.syncType === trigger.syncType)
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
              {active.map((log) => (
                <ActiveSyncItem key={log.id} log={log} />
              ))}
            </section>
          ) : null}

          {(active.length > 0 || recent.length > 0) && active.length > 0 && recent.length > 0 ? (
            <Separator />
          ) : null}

          {recent.length > 0 ? (
            <section className="gap-sm flex flex-col">
              <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
                {t('sections.recent')}
              </h3>
              {recent.map((log) => (
                <RecentSyncItem key={log.id} log={log} />
              ))}
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

function ActiveSyncItem({ log }: { log: SyncCenterLog }): React.ReactElement {
  const t = useTranslations('syncCenter');
  const formatter = useFormatter();
  const percent =
    log.progressTotal !== null && log.progressTotal > 0
      ? Math.min(100, Math.round((log.progressCurrent / log.progressTotal) * 100))
      : null;

  return (
    <div className="border-border bg-card gap-xs flex flex-col rounded-md border p-3">
      <div className="gap-sm flex items-center">
        <Time04Icon className="size-icon-sm text-info animate-spin" />
        <span className="text-foreground text-sm font-medium">{t(`triggers.${log.syncType}`)}</span>
        <Badge tone="info" size="sm" className="ml-auto">
          {t('status.running')}
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

function RecentSyncItem({ log }: { log: SyncCenterLog }): React.ReactElement {
  const t = useTranslations('syncCenter');
  const formatter = useFormatter();
  const mounted = useIsMounted();

  const Icon = log.status === 'FAILED' ? AlertCircleIcon : CheckmarkCircle02Icon;
  const toneClass = log.status === 'FAILED' ? 'text-destructive' : 'text-success';

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
            {t(`triggers.${log.syncType}`)}
          </span>
          <span className="text-muted-foreground text-2xs">{timeLabel}</span>
        </div>
        {log.status === 'COMPLETED' ? (
          <span className="text-muted-foreground text-2xs tabular-nums">
            {t('completedSummary', {
              n: formatter.number(log.recordsProcessed, 'integer'),
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
