import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The two-tone spinning ring used by the sync-freshness surfaces (SyncControl
 * status half + action icon, SyncSourcesPopover syncing chip). A CSS-only ring
 * — track in `--info-surface`, indicator in `--info` — so it reads as a live
 * "syncing" signal without pulling in an icon font. `animate-spin` is the
 * system's continuous-motion exception (exempt from prefers-reduced-motion,
 * matching the shared Spinner primitive).
 *
 * Override the track/indicator with `className` when the ring sits on a tinted
 * chip (e.g. `border-card border-t-info` on a `bg-info-surface` chip, where the
 * default `border-info-surface` track would vanish).
 *
 * @useWhen showing the in-flight "syncing" indicator inside a SyncControl / SyncSourcesPopover
 */
export function SyncSpinner({ className }: { className?: string }): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        'border-info-surface border-t-info size-3 shrink-0 animate-spin rounded-full border-2',
        className,
      )}
    />
  );
}
