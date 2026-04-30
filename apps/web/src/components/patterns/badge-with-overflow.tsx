import * as React from 'react';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Badge with an optional `+N` overflow chip on the right.
 *
 * Use when a domain entity may have multiple variants of mixed metadata
 * (delivery time, status, tag) — the badge carries the primary value,
 * the overflow count signals "and N others" without exploding into a
 * dense badge stack.
 *
 * Composes `Badge` from `ui/`. Domain-specific enum→tone+label mappings
 * stay in feature components and pass `tone` + `children` through.
 *
 * @useWhen rendering a single status badge that may be paired with a "+N" overflow indicator
 */
export interface BadgeWithOverflowProps {
  /** Tone of the primary badge. Forwarded to `Badge`. */
  tone?: BadgeProps['tone'];
  /** Main badge content (typically a translated label). */
  children: React.ReactNode;
  /** When > 0, renders a "+N" muted chip to the right of the badge. */
  overflowCount?: number;
  className?: string;
}

export function BadgeWithOverflow({
  tone,
  children,
  overflowCount,
  className,
}: BadgeWithOverflowProps): React.ReactElement {
  if (overflowCount === undefined || overflowCount <= 0) {
    return (
      <Badge tone={tone} className={className}>
        {children}
      </Badge>
    );
  }
  return (
    <span className={cn('gap-2xs inline-flex items-center', className)}>
      <Badge tone={tone}>{children}</Badge>
      <span className="text-muted-foreground text-2xs">+{overflowCount}</span>
    </span>
  );
}
