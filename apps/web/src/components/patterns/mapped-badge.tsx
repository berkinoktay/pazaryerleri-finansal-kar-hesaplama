import * as React from 'react';

import { BadgeWithOverflow } from '@/components/patterns/badge-with-overflow';
import { type BadgeProps } from '@/components/ui/badge';

/**
 * Generic enum→tone+label badge. Caller supplies a string-keyed value
 * plus matching `toneMap` and `labelMap` records; the component handles
 * Badge tone selection, label rendering, and the optional `+N` overflow
 * chip via `BadgeWithOverflow`.
 *
 * Use when a domain enum (variant status, delivery state, payout
 * health) maps cleanly to a Badge tone + a translated label. When the
 * mapping is conditional (e.g. one value picks a tone based on another
 * flag — see `delivery-badge.tsx`), keep the conditional logic in the
 * domain component and reach for `BadgeWithOverflow` directly instead.
 *
 * @useWhen rendering a status badge driven by a string enum with a static tone+label mapping (use BadgeWithOverflow directly when the tone depends on conditional logic)
 */

export interface MappedBadgeProps<K extends string> {
  /** Current enum value. */
  value: K;
  /** Enum value → Badge tone. Must cover every member of `K`. */
  toneMap: Record<K, BadgeProps['tone']>;
  /**
   * Enum value → translated label node. Must cover every member of
   * `K`. Pass already-translated strings (or React nodes) so this
   * component stays i18n-agnostic.
   */
  labelMap: Record<K, React.ReactNode>;
  /** When > 0, renders a "+N" muted chip to the right of the badge. */
  overflowCount?: number;
  className?: string;
}

export function MappedBadge<K extends string>({
  value,
  toneMap,
  labelMap,
  overflowCount,
  className,
}: MappedBadgeProps<K>): React.ReactElement {
  return (
    <BadgeWithOverflow tone={toneMap[value]} overflowCount={overflowCount} className={className}>
      {labelMap[value]}
    </BadgeWithOverflow>
  );
}
