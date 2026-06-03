import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The recurring "principal row" shape across the app chrome: a leading
 * avatar/logo tile, a min-width-0 text column (truncating title + optional
 * secondary meta line), and an optional trailing control (chevron, radio,
 * role badge). Before this, the org/store switcher chip, the user-menu
 * trigger, and every org/store list row hand-rolled the same
 * `min-w-0 flex-col leading-tight + truncate + text-2xs muted meta` block —
 * four copies of one truncation/spacing contract that drifted apart.
 *
 * IdentityCell owns that contract once so the chip, the trigger, and the
 * rows share identical wrapping behavior. It is layout only — the caller
 * supplies the avatar node (so it can pick a marketplace logo, an org
 * palette tile, or user initials), the title node (which may be a
 * highlighted search match), and any trailing affordance.
 *
 * The `meta` slot is a free flex row (so a caller can drop a StatusDot
 * before the text); plain-text meta should be wrapped in a `truncate`
 * span by the caller since only the title truncates by default.
 *
 * @useWhen rendering an avatar + name + secondary-line + trailing row in the app chrome (switcher chip/rows, account trigger) — keeps one truncation/spacing contract across all of them
 */
export interface IdentityCellProps {
  /** Leading avatar / logo / icon tile. The caller sizes it. */
  leading: React.ReactNode;
  /** Primary line — the entity name. Truncates. May be a highlighted match node. */
  title: React.ReactNode;
  /** Secondary line. Rendered in a `text-2xs` muted flex row; wrap plain text in a `truncate` span. */
  meta?: React.ReactNode;
  /** Trailing affordance (chevron pill, radio dot, role badge, …). Does not shrink. */
  trailing?: React.ReactNode;
  /** Title text scale: `sm` (text-xs, default — list rows / trigger) or `md` (text-sm — identity headers). */
  size?: 'sm' | 'md';
  className?: string;
  /** Extra classes on the title span (weight/color overrides). */
  titleClassName?: string;
}

export function IdentityCell({
  leading,
  title,
  meta,
  trailing,
  size = 'sm',
  className,
  titleClassName,
}: IdentityCellProps): React.ReactElement {
  return (
    <span className={cn('gap-xs flex min-w-0 items-center', className)}>
      {leading}
      <span className="gap-3xs flex min-w-0 flex-1 flex-col leading-tight">
        <span
          className={cn(
            'text-foreground truncate text-left font-medium',
            size === 'md' ? 'text-sm font-semibold' : 'text-xs',
            titleClassName,
          )}
        >
          {title}
        </span>
        {meta !== undefined ? (
          <span className="text-muted-foreground text-2xs gap-3xs flex min-w-0 items-center">
            {meta}
          </span>
        ) : null}
      </span>
      {trailing}
    </span>
  );
}
