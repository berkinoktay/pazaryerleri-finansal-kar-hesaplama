'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { Banner } from '@/components/patterns/banner';
import { Button } from '@/components/ui/button';

import { PAGE_SYNC_SOURCES, type PageSyncKey } from '../config/page-sync-sources';
import { usePageSyncSnapshot } from '../hooks/use-page-sync-snapshot';
import { useStartPageSync } from '../hooks/use-start-page-sync';
import { deriveStaleHours, newestPrimarySyncedAt } from '../lib/stale-data';

/**
 * A warning strip shown between the PageHeader and the table when the page's
 * data has aged past its stale window (issue #466). The freshness chip is a
 * passive signal; this is the loud one — "Bu veriler {hours} saattir
 * güncellenmedi · Şimdi eşitle". The action fires the exact same manual sync as
 * the header control (shared useStartPageSync). Composes the Banner pattern in
 * its `warning` tone (no fork) with a full-perimeter hairline — an in-flow
 * region, never an overlay, so it stays consistent with "no self-appearing
 * surfaces".
 *
 * Staleness is measured against the page's PRIMARY sources only (via
 * newestPrimarySyncedAt), not the control's all-sources timestamp: on Returns a
 * fresh secondary ORDERS must not mask a 30-hour-old primary CLAIMS, and on
 * Products a fresh hourly PRODUCTS_DELTA keeps the page fresh even after the
 * nightly full PRODUCTS scan ages.
 *
 * Renders `null` (nothing) unless the latched clock is set AND the newest
 * primary success is older than `staleAfterHours`. It also stays silent whenever
 * the freshness chip is already carrying a stronger state — a running sync
 * ('syncing'), a hard failure ('failed'), or a retry ('retrying') — so the loud
 * amber strip never double-signals on top of a blue/red/amber chip. SSR-safe:
 * the snapshot's `now` is null through SSR + first paint, so the server never
 * renders the strip.
 */
export function StaleDataBanner({ pageKey }: { pageKey: PageSyncKey }): React.ReactElement | null {
  const t = useTranslations('syncControl');
  const snapshot = usePageSyncSnapshot(pageKey);
  const { startPageSync, disabled } = useStartPageSync(pageKey);

  const { control, sources, now } = snapshot;

  // The chip already shouts these states (blue / red / amber). Don't stack the
  // stale strip on top of a stronger signal.
  if (control.state === 'syncing' || control.state === 'failed' || control.state === 'retrying') {
    return null;
  }

  // Pre-latch (SSR + first paint): nothing to measure.
  if (now === null) return null;

  // Measure only the page's own subject — the primary flow(s).
  const lastSyncedAt = newestPrimarySyncedAt(sources, PAGE_SYNC_SOURCES[pageKey].primary);
  if (lastSyncedAt === null) return null;

  const hours = deriveStaleHours(lastSyncedAt, now, PAGE_SYNC_SOURCES[pageKey].staleAfterHours);
  if (hours === null) return null;

  return (
    <Banner
      tone="warning"
      title={t('staleBanner.message', { hours })}
      className="rounded-lg border"
      action={
        <Button variant="outline" size="sm" onClick={startPageSync} disabled={disabled}>
          {t('staleBanner.action')}
        </Button>
      }
    />
  );
}
