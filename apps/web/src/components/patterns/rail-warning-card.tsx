'use client';

import * as React from 'react';
import { AlertCircleIcon } from 'hugeicons-react';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface RailWarningCardProps {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
  tone?: 'warning' | 'destructive';
}

const TONE = {
  warning: {
    bg: 'bg-warning-surface',
    border: 'border-warning-border',
    title: 'text-warning',
    body: 'text-warning',
  },
  destructive: {
    bg: 'bg-destructive-surface',
    border: 'border-destructive-border',
    title: 'text-destructive',
    body: 'text-destructive',
  },
} as const;

/**
 * Slim warning card for the ContextRail middle. Conditional —
 * only render when there's an actionable issue (eksik maliyet,
 * sync hatası, vb.). Optional CTA links to the page that resolves it.
 * For full-width page-level alerts use Alert; for app-spanning system
 * messages use the future Banner molecule.
 *
 * @useWhen surfacing an actionable issue inline in the ContextRail (use Alert for page-width inline messages, future Banner for app-spanning system messages)
 */
export function RailWarningCard({
  title,
  description,
  ctaLabel,
  ctaHref,
  tone = 'warning',
}: RailWarningCardProps): React.ReactElement {
  const t = TONE[tone];
  return (
    <div className={cn('p-xs gap-3xs flex flex-col rounded-md border', t.bg, t.border)}>
      <div className="gap-3xs flex items-center">
        <AlertCircleIcon className={cn('size-icon-sm', t.title)} />
        <span className={cn('text-xs font-semibold', t.title)}>{title}</span>
      </div>
      <p className={cn('text-2xs', t.body)}>{description}</p>
      {ctaHref && ctaLabel ? (
        <Link href={ctaHref} className="text-primary text-xs font-semibold hover:underline">
          {ctaLabel} →
        </Link>
      ) : null}
    </div>
  );
}
